# the AD-12 error codes; service code raises these and the wrapper turns them into the envelope


class ApiError(Exception):
    status = 500
    code = "internal"

    def __init__(self, message: str, fields: dict[str, str] | None = None):
        super().__init__(message)
        self.message = message
        self.fields = fields


class BadRequest(ApiError):
    status = 400
    code = "bad_request"


class ValidationFailed(ApiError):
    status = 400
    code = "validation_failed"


class Unauthenticated(ApiError):
    status = 401
    code = "unauthenticated"


class Forbidden(ApiError):
    status = 403
    code = "forbidden"


class NotFound(ApiError):
    status = 404
    code = "not_found"


class MethodNotAllowed(ApiError):
    status = 405
    code = "method_not_allowed"

    def __init__(self, allowed: list[str]):
        super().__init__(f"method not allowed; allowed: {', '.join(allowed)}")
        self.allowed = allowed


class Conflict(ApiError):
    status = 409
    code = "conflict"
