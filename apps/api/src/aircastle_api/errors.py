"""RFC 9457 problem details: the one shape every API error takes."""

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, ClassVar

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException

PROBLEM_JSON = "application/problem+json"


class Problem(BaseModel):
    """An RFC 9457 problem details body."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    instance: str


class FieldError(BaseModel):
    """One invalid part of a request: where it is, and why it failed."""

    path: list[str | int]
    message: str


class ValidationProblem(Problem):
    """A problem for a request that failed validation, listing each failure."""

    errors: list[FieldError]


class DomainError(Exception):
    """An expected failure, answered with a problem response.

    Subclasses choose the HTTP status. The detail is shown to the caller.
    """

    status: ClassVar[HTTPStatus] = HTTPStatus.BAD_REQUEST

    def __init__(
        self, detail: str, *, headers: Mapping[str, str] | None = None
    ) -> None:
        """Describe this occurrence, with any headers the response should carry."""
        super().__init__(detail)
        self.detail = detail
        self.headers = headers


PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    "422": {"model": ValidationProblem, "description": "Validation problem"},
    "default": {"model": Problem, "description": "Problem"},
}
"""The error responses every operation declares, for FastAPI's `responses`."""


def problem_response(
    request: Request,
    status: HTTPStatus,
    detail: str,
    *,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    """Answer `request` with a problem of the given status."""
    problem = Problem(
        title=status.phrase,
        status=status,
        detail=detail,
        instance=request.url.path,
    )
    return _render(problem, headers)


def _render(problem: Problem, headers: Mapping[str, str] | None = None) -> JSONResponse:
    return JSONResponse(
        problem.model_dump(mode="json"),
        status_code=problem.status,
        headers=headers,
        media_type=PROBLEM_JSON,
    )


def _validation_response(
    request: Request, error: RequestValidationError
) -> JSONResponse:
    status = HTTPStatus.UNPROCESSABLE_CONTENT
    problem = ValidationProblem(
        title=status.phrase,
        status=status,
        detail="The request failed validation.",
        instance=request.url.path,
        errors=[
            FieldError(path=list(failure["loc"]), message=failure["msg"])
            for failure in error.errors()
        ],
    )
    return _render(problem)


async def _problem_for(request: Request, error: Exception) -> JSONResponse:
    match error:
        case RequestValidationError():
            return _validation_response(request, error)
        case DomainError(status=status, detail=detail, headers=headers):
            return problem_response(request, status, detail, headers=headers)
        case HTTPException(status_code=code, detail=detail, headers=headers):
            return problem_response(request, HTTPStatus(code), detail, headers=headers)
        case _:
            return problem_response(
                request,
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "The server hit an unexpected error.",
            )


def add_problem_handlers(app: FastAPI) -> None:
    """Answer every error the app raises with a problem response."""
    for error in (RequestValidationError, DomainError, HTTPException, Exception):
        app.add_exception_handler(error, _problem_for)


def document_problems(app: FastAPI) -> None:
    """Declare every error response in the app's OpenAPI document as problem+json.

    An operation with no parameters or body never fails validation, so its 422
    is left out.
    """
    generate = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            for path in generate()["paths"].values():
                for operation in path.values():
                    responses = operation["responses"]
                    if not {"parameters", "requestBody"} & operation.keys():
                        del responses["422"]
                    for status, response in responses.items():
                        if status == "default" or status.startswith(("4", "5")):
                            content = response["content"]
                            content[PROBLEM_JSON] = content.pop("application/json")
        return generate()

    app.openapi = openapi
