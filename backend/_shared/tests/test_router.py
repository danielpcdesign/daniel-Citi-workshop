import pytest

from _shared.errors import MethodNotAllowed, NotFound
from _shared.router import Router

ANY = {"employee", "engineer", "admin"}


def list_incidents():
    return {}


def create_incident():
    return {}


def get_incident():
    return {}


def list_notes():
    return {}


@pytest.fixture
def router() -> Router:
    r = Router("incidents")
    r.add("GET", "/", list_incidents, roles=ANY)
    r.add("POST", "/", create_incident, roles={"employee"})
    r.add("GET", "/{incident_id}", get_incident, roles=ANY)
    r.add("GET", "/{incident_id}/notes", list_notes, roles=ANY)
    return r


# the same request arrives in two shapes (AD-05, observed on 2026-09-23)
@pytest.mark.parametrize("path", [
    "/api/incidents/42/notes",   # cloudfront: full path
    "/42/notes",                 # local dev proxy: prefix stripped
    "/api/incidents//42/notes/", # repeated and trailing slashes
])
def test_cloud_and_local_paths_resolve_to_the_same_route(router, path):
    route, params = router.resolve("GET", path)
    assert route.handler is list_notes
    assert params == {"incident_id": "42"}


@pytest.mark.parametrize("path", ["/api/incidents", "/api/incidents/", "/", ""])
def test_collection_root_forms(router, path):
    route, params = router.resolve("GET", path)
    assert route.handler is list_incidents
    assert params == {}


def test_method_selects_the_handler(router):
    assert router.resolve("POST", "/api/incidents")[0].handler is create_incident


def test_method_is_case_insensitive(router):
    assert router.resolve("get", "/7")[0].handler is get_incident


def test_prefix_is_stripped_only_on_a_segment_boundary(router):
    # /api/incidentsx is a different service, not /api/incidents + "x"
    assert router.normalize("/api/incidentsx/1") == "/api/incidentsx/1"
    with pytest.raises(NotFound):
        router.resolve("GET", "/api/incidentsx/1")


def test_unknown_path_is_not_found(router):
    with pytest.raises(NotFound):
        router.resolve("GET", "/42/attachments")


def test_extra_segments_do_not_partially_match(router):
    with pytest.raises(NotFound):
        router.resolve("GET", "/42/notes/9/extra")


def test_known_path_wrong_method_lists_allowed_methods(router):
    with pytest.raises(MethodNotAllowed) as caught:
        router.resolve("DELETE", "/")
    assert caught.value.allowed == ["GET", "POST"]


def test_params_are_decoded_once(router):
    # %20 is a space; %2520 is a literal "%20" and must not become a space
    assert router.resolve("GET", "/a%20b")[1] == {"incident_id": "a b"}
    assert router.resolve("GET", "/a%2520b")[1] == {"incident_id": "a%20b"}


def test_encoded_slash_stays_inside_one_param(router):
    # decoding after matching means %2F cannot split the path into more segments
    route, params = router.resolve("GET", "/a%2Fb/notes")
    assert route.handler is list_notes
    assert params == {"incident_id": "a/b"}


def test_duplicate_registration_is_rejected(router):
    with pytest.raises(ValueError, match="duplicate route"):
        router.add("GET", "/{incident_id}", get_incident, roles=ANY)


def test_decorator_registers_and_returns_the_handler():
    r = Router("auth")

    @r.on("post", "/refresh", public=True)
    def refresh():
        return {}

    assert refresh() == {}
    route = r.resolve("POST", "/api/auth/refresh")[0]
    assert route.handler is refresh
    assert route.public and route.roles == frozenset()


# AD-09: closed by default, so access must be declared, exactly once, with known roles
@pytest.mark.parametrize("access", [{}, {"roles": set()}, {"roles": {"admin"}, "public": True}])
def test_route_must_declare_access_exactly_once(access):
    with pytest.raises(ValueError, match="declare exactly one"):
        Router("x").add("GET", "/", list_incidents, **access)


def test_unknown_role_is_rejected():
    with pytest.raises(ValueError, match="unknown roles"):
        Router("x").add("GET", "/", list_incidents, roles={"superuser"})


def test_route_carries_its_roles(router):
    route, _ = router.resolve("POST", "/")
    assert route.roles == frozenset({"employee"})
    assert not route.public


def test_literal_segment_beats_a_param_regardless_of_registration_order():
    r = Router("incidents")
    r.add("GET", "/{incident_id}", get_incident, roles=ANY)
    r.add("GET", "/summary", list_incidents, roles=ANY)
    assert r.resolve("GET", "/summary")[0].handler is list_incidents
    assert r.resolve("GET", "/42")[0].handler is get_incident


def test_method_on_a_less_specific_pattern_still_matches():
    # /summary only has GET, but /{incident_id} has DELETE: DELETE /summary goes to the param route
    r = Router("incidents")
    r.add("GET", "/summary", list_incidents, roles=ANY)
    r.add("DELETE", "/{incident_id}", get_incident, roles={"admin"})
    route, params = r.resolve("DELETE", "/summary")
    assert (route.handler, params) == (get_incident, {"incident_id": "summary"})


def test_405_lists_methods_from_every_matching_pattern():
    r = Router("incidents")
    r.add("GET", "/summary", list_incidents, roles=ANY)
    r.add("DELETE", "/{incident_id}", get_incident, roles={"admin"})
    with pytest.raises(MethodNotAllowed) as caught:
        r.resolve("PUT", "/summary")
    assert caught.value.allowed == ["DELETE", "GET"]
