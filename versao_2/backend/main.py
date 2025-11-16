import time
from datetime import datetime, timezone

import requests
import urllib3
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

BYBIT_API_URL = "https://api.bybit.com"

# Em ambiente corporativo com proxy e certificado insano:
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(
    title="Bybit Funding Backend",
    description="Backend simples para consultar funding de contratos perpétuos USDT da Bybit",
    version="2.0.0",
)

# 🔓 CORS liberado (pra funcionar com qualquer front)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # se quiser travar, troca pra origem específica
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_instruments_perpetual_usdt():
    """
    Busca TODOS os instrumentos linear e retorna apenas os contratos perpétuos USDT.
    """
    resultados = []
    category = "linear"
    cursor = None

    while True:
        params = {
            "category": category,
            "status": "Trading",  # só pares ativos
            "limit": 1000,
        }
        if cursor:
            params["cursor"] = cursor

        try:
            resp = requests.get(
                f"{BYBIT_API_URL}/v5/market/instruments-info",
                params=params,
                timeout=10,
                verify=False,  # por causa de proxy corporativo
            )
        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=502, detail=f"Erro em instruments-info: {e}")

        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"HTTP {resp.status_code} em instruments-info")

        try:
            data = resp.json()
        except ValueError:
            raise HTTPException(status_code=502, detail="Falha ao decodificar JSON em instruments-info")

        if data.get("retCode") != 0:
            raise HTTPException(
                status_code=502,
                detail=f"retCode != 0 em instruments-info: {data.get('retCode')} - {data.get('retMsg')}",
            )

        result = data.get("result", {})
        lista = result.get("list", [])
        cursor = result.get("nextPageCursor")

        for inst in lista:
            contract_type = inst.get("contractType")
            symbol = inst.get("symbol")
            quote_coin = inst.get("quoteCoin")

            if contract_type != "LinearPerpetual":
                continue
            if quote_coin != "USDT":
                continue
            if not symbol:
                continue

            resultados.append(
                {
                    "symbol": symbol,
                    "category": category,
                    "quoteCoin": quote_coin,
                    "contractType": contract_type,
                }
            )

        if not cursor:
            break

    return resultados


def get_all_tickers_linear():
    """
    Busca TODOS os tickers da categoria linear de uma vez.
    Retorna dict { symbol: ticker_dict }.
    """
    params = {"category": "linear"}

    try:
        resp = requests.get(
            f"{BYBIT_API_URL}/v5/market/tickers",
            params=params,
            timeout=10,
            verify=False,  # proxy corporativo
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Erro em tickers: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"HTTP {resp.status_code} em tickers")

    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Falha ao decodificar JSON em tickers")

    if data.get("retCode") != 0:
        raise HTTPException(
            status_code=502,
            detail=f"retCode != 0 em tickers: {data.get('retCode')} - {data.get('retMsg')}",
        )

    lista = data.get("result", {}).get("list", [])
    tickers = {}

    for t in lista:
        symbol = t.get("symbol")
        if symbol:
            tickers[symbol] = t

    return tickers


def formatar_tempo_restante(next_funding_ms: str) -> str:
    if not next_funding_ms:
        return "-"

    try:
        next_ts = int(next_funding_ms) / 1000.0
        dt_next = datetime.fromtimestamp(next_ts, tz=timezone.utc)
        now = datetime.now(timezone.utc)
        diff = (dt_next - now).total_seconds()
        if diff <= 0:
            return "00:00:00"

        horas = int(diff // 3600)
        minutos = int((diff % 3600) // 60)
        segundos = int(diff % 60)
        return f"{horas:02d}:{minutos:02d}:{segundos:02d}"
    except Exception:
        return "-"


def calcular_direcao(funding_rate: float) -> str:
    if funding_rate > 0:
        return "Long paga Short"
    if funding_rate < 0:
        return "Short paga Long"
    return "Neutro"


@app.get("/funding")
def funding_endpoint(
    notional: float = Query(1000.0, gt=0, description="Notional em USDT para simular o valor do trade"),
):
    """
    Retorna informações de funding para TODOS os contratos perpétuos USDT (LinearPerpetual).
    """
    start = time.perf_counter()

    instrumentos = get_instruments_perpetual_usdt()
    if not instrumentos:
        raise HTTPException(status_code=500, detail="Nenhum contrato perpétuo USDT encontrado")

    tickers_linear = get_all_tickers_linear()

    linhas = []

    for inst in instrumentos:
        symbol = inst["symbol"]
        category = inst["category"]

        ticker = tickers_linear.get(symbol)
        if ticker is None:
            continue

        last_price = ticker.get("lastPrice", "-")
        index_price = ticker.get("indexPrice", "-")
        mark_price = ticker.get("markPrice", "-")
        funding_rate_str = ticker.get("fundingRate", "0")
        next_funding_time = ticker.get("nextFundingTime", "")
        funding_interval_hour_str = ticker.get("fundingIntervalHour", "8")

        try:
            funding_rate = float(funding_rate_str)
        except ValueError:
            funding_rate = 0.0

        try:
            funding_interval_hour = float(funding_interval_hour_str)
            if funding_interval_hour <= 0:
                funding_interval_hour = 8.0
        except ValueError:
            funding_interval_hour = 8.0

        funding_rate_pct = funding_rate * 100.0
        direcao = calcular_direcao(funding_rate)
        taxa_ciclo = notional * funding_rate
        taxa_hora = taxa_ciclo / funding_interval_hour if funding_interval_hour != 0 else 0.0
        tempo_restante = formatar_tempo_restante(next_funding_time)

        def safe_float(x: str):
            try:
                return float(x)
            except Exception:
                return None

        linha = {
            "symbol": symbol,
            "category": category,
            "notional": notional,
            "funding_rate_pct": funding_rate_pct,
            "direcao": direcao,
            "taxa_ciclo": taxa_ciclo,
            "taxa_hora": taxa_hora,
            "last_price": safe_float(last_price),
            "index_price": safe_float(index_price),
            "mark_price": safe_float(mark_price),
            "funding_interval_hour": funding_interval_hour,
            "tempo_restante": tempo_restante,
        }

        linhas.append(linha)

    # ordena por funding desc
    linhas.sort(key=lambda x: x["funding_rate_pct"], reverse=True)

    end = time.perf_counter()
    elapsed = end - start

    return {
        "notional": notional,
        "count": len(linhas),
        "elapsed_seconds": elapsed,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data": linhas,
    }
