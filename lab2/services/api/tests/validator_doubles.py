"""Validadores simulados por transporte HTTP.

La API los consulta con su cliente real (httpx): lo único simulado es el otro lado de la conexión.
"""

import httpx


def approving(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"valid": True, "errors": []})


def rejecting(errors: list[str]):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"valid": False, "errors": errors})

    return handler


def connect_error(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("sin conexión", request=request)


def read_timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("demasiado lento", request=request)


def server_error(request: httpx.Request) -> httpx.Response:
    # El peor caso: un 500 cuyo cuerpo parece una aprobación. El código de estado manda, no el cuerpo.
    return httpx.Response(500, json={"valid": True, "errors": []})


def not_json(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text="<html>no es json</html>")


def wrong_shape(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"ok": True})
