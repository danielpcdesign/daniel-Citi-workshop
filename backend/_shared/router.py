import re
from collections.abc import Callable
from urllib.parse import unquote

Handler = Callable[..., dict]

# a pattern segment like {incident_id}
_PARAM = re.compile(r"^\{([a-z_][a-z0-9_]*)\}$")


class NotFound(Exception):
    pass


class MethodNotAllowed(Exception):
    def __init__(self, allowed: list[str]):
        super().__init__(f"allowed: {', '.join(allowed)}")
        self.allowed = allowed


# maps (method, path) to a handler for one service (AD-05)
class Router:
    def __init__(self, service: str):
        # cloudfront delivers /api/<service>/...; the local dev proxy strips it
        self._prefix = f"/api/{service}"
        self._routes: list[tuple[re.Pattern, dict[str, Handler]]] = []
        self._patterns: dict[str, dict[str, Handler]] = {}

    def on(self, method: str, pattern: str) -> Callable[[Handler], Handler]:
        def register(handler: Handler) -> Handler:
            self.add(method, pattern, handler)
            return handler
        return register

    def add(self, method: str, pattern: str, handler: Handler) -> None:
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
        methods[method] = handler

    def normalize(self, path: str) -> str:
        # collapse repeated slashes and drop a trailing one
        path = "/" + "/".join(seg for seg in path.split("/") if seg)
        # prefix match on a segment boundary, so /api/authx is not treated as /api/auth
        if path == self._prefix or path.startswith(self._prefix + "/"):
            path = path[len(self._prefix):] or "/"
        return path

    def resolve(self, method: str, path: str) -> tuple[Handler, dict[str, str]]:
        path = self.normalize(path)
        for regex, methods in self._routes:
            match = regex.fullmatch(path)
            if match is None:
                continue
            handler = methods.get(method.upper())
            if handler is None:
                raise MethodNotAllowed(sorted(methods))
            # decode each captured value once, after matching, so an encoded "/" cannot split a segment
            params = {name: unquote(value) for name, value in match.groupdict().items()}
            return handler, params
        raise NotFound(path)

    @staticmethod
    def _compile(pattern: str) -> re.Pattern:
        parts = []
        for seg in pattern.strip("/").split("/"):
            if not seg:
                continue
            param = _PARAM.match(seg)
            parts.append(f"(?P<{param.group(1)}>[^/]+)" if param else re.escape(seg))
        return re.compile("/" + "/".join(parts))
