import re
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import unquote

from .authz import ROLES
from .errors import MethodNotAllowed, NotFound

Handler = Callable[..., object]

# a pattern segment like {incident_id}
_PARAM = re.compile(r"^\{([a-z_][a-z0-9_]*)\}$")


@dataclass(frozen=True)
class Route:
    method: str
    pattern: str
    handler: Handler
    roles: frozenset[str]
    public: bool


# maps (method, path) to a route for one service (AD-05)
class Router:
    def __init__(self, service: str):
        self.service = service
        # cloudfront delivers /api/<service>/...; the local dev proxy strips it
        self._prefix = f"/api/{service}"
        self._routes: list[tuple[re.Pattern, dict[str, Route]]] = []
        self._patterns: dict[str, dict[str, Route]] = {}

    def on(
        self, method: str, pattern: str, *, roles: set[str] | None = None, public: bool = False
    ) -> Callable[[Handler], Handler]:
        def register(handler: Handler) -> Handler:
            self.add(method, pattern, handler, roles=roles, public=public)
            return handler
        return register

    def add(
        self, method: str, pattern: str, handler: Handler,
        *, roles: set[str] | None = None, public: bool = False,
    ) -> None:
        # closed by default (AD-09): a route that says nothing about access is a startup error
        if public == bool(roles):
            raise ValueError(f"{method} {pattern}: declare exactly one of roles=... or public=True")
        unknown = set(roles or ()) - ROLES
        if unknown:
            raise ValueError(f"{method} {pattern}: unknown roles {sorted(unknown)}")

        pattern = self.normalize(pattern)
        methods = self._patterns.get(pattern)
        if methods is None:
            methods = {}
            self._patterns[pattern] = methods
            self._routes.append((self._compile(pattern), methods))
        method = method.upper()
        # a second registration would silently shadow the first
        if method in methods:
            raise ValueError(f"duplicate route: {method} {pattern}")
        methods[method] = Route(method, pattern, handler, frozenset(roles or ()), public)

    def normalize(self, path: str) -> str:
        # collapse repeated slashes and drop a trailing one
        path = "/" + "/".join(seg for seg in path.split("/") if seg)
        # prefix match on a segment boundary, so /api/authx is not treated as /api/auth
        if path == self._prefix or path.startswith(self._prefix + "/"):
            path = path[len(self._prefix):] or "/"
        return path

    def resolve(self, method: str, path: str) -> tuple[Route, dict[str, str]]:
        path = self.normalize(path)
        method = method.upper()
        matches = []
        for regex, methods in self._routes:
            match = regex.fullmatch(path)
            if match is not None:
                matches.append((match, methods))
        # most specific first: a literal segment beats a {param}, so /summary is never
        # swallowed by /{incident_id} whatever order the routes were registered in
        matches.sort(key=lambda pair: len(pair[0].groupdict()))
        for match, methods in matches:
            route = methods.get(method)
            if route is not None:
                # decode each captured value once, after matching, so an encoded "/" cannot split a segment
                params = {name: unquote(value) for name, value in match.groupdict().items()}
                return route, params
        if matches:
            # the path exists under some pattern, just not for this method
            raise MethodNotAllowed(sorted({m for _, methods in matches for m in methods}))
        raise NotFound("no such route")

    @staticmethod
    def _compile(pattern: str) -> re.Pattern:
        parts = []
        for seg in pattern.strip("/").split("/"):
            if not seg:
                continue
            param = _PARAM.match(seg)
            parts.append(f"(?P<{param.group(1)}>[^/]+)" if param else re.escape(seg))
        return re.compile("/" + "/".join(parts))
