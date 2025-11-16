const BYBIT_API_URL = "https://api.bybit.com";
let autoRefreshInterval = null;
let countdownInterval = null;
const REFRESH_SECONDS = 30;
let remainingSeconds = REFRESH_SECONDS;
let currentNotional = null;
let lastElapsedSeconds = null;

const statusText = document.getElementById("statusText");
const infoBox = document.getElementById("infoBox");
const infoNotional = document.getElementById("infoNotional");
const infoMoedas = document.getElementById("infoMoedas");
const infoTempo = document.getElementById("infoTempo");
const infoNextRefresh = document.getElementById("infoNextRefresh");
const fundingTable = document.getElementById("fundingTable");
const btnAtualizar = document.getElementById("btnAtualizar");
const notionalInput = document.getElementById("notionalInput");

async function fetchInstrumentsPerpetualUSDT() {
    let resultados = [];
    let category = "linear";
    let cursor = null;

    while (true) {
        const params = new URLSearchParams({
            category: category,
            status: "Trading",
            limit: "1000"
        });
        if (cursor) params.append("cursor", cursor);

        const url = `${BYBIT_API_URL}/v5/market/instruments-info?${params.toString()}`;

        let resp;
        try {
            resp = await fetch(url);
        } catch (e) {
            console.error("Erro ao chamar instruments-info:", e);
            throw new Error("Erro de rede em instruments-info");
        }

        if (!resp.ok) {
            console.error("HTTP em instruments-info:", resp.status);
            throw new Error(`HTTP ${resp.status} em instruments-info`);
        }

        const data = await resp.json().catch(() => {
            throw new Error("Falha ao decodificar JSON em instruments-info");
        });

        if (data.retCode !== 0) {
            console.error("retCode instrumentos:", data.retCode, data.retMsg);
            throw new Error("retCode != 0 em instruments-info");
        }

        const result = data.result || {};
        const lista = result.list || [];
        cursor = result.nextPageCursor;

        for (const inst of lista) {
            const contractType = inst.contractType;
            const symbol = inst.symbol;
            const quoteCoin = inst.quoteCoin;

            if (contractType !== "LinearPerpetual") continue;
            if (quoteCoin !== "USDT") continue;
            if (!symbol) continue;

            resultados.push({
                symbol: symbol,
                category: category,
                quoteCoin: quoteCoin,
                contractType: contractType
            });
        }

        if (!cursor) break;
    }

    return resultados;
}

async function fetchAllTickersLinear() {
    const params = new URLSearchParams({ category: "linear" });
    const url = `${BYBIT_API_URL}/v5/market/tickers?${params.toString()}`;

    let resp;
    try {
        resp = await fetch(url);
    } catch (e) {
        console.error("Erro ao chamar tickers em lote:", e);
        throw new Error("Erro de rede em tickers");
    }

    if (!resp.ok) {
        console.error("HTTP em tickers:", resp.status);
        throw new Error(`HTTP ${resp.status} em tickers`);
    }

    const data = await resp.json().catch(() => {
        throw new Error("Falha ao decodificar JSON em tickers");
    });

    if (data.retCode !== 0) {
        console.error("retCode tickers:", data.retCode, data.retMsg);
        throw new Error("retCode != 0 em tickers");
    }

    const lista = (data.result && data.result.list) || [];
    const tickers = {};
    for (const t of lista) {
        if (t.symbol) tickers[t.symbol] = t;
    }
    return tickers;
}

function formatarTempoRestante(nextFundingMs) {
    if (!nextFundingMs) return "-";
    try {
        const nextTs = parseInt(nextFundingMs, 10) / 1000.0;
        if (isNaN(nextTs)) return "-";
        const dtNext = new Date(nextTs * 1000);
        const now = new Date();
        let diff = (dtNext.getTime() - now.getTime()) / 1000;
        if (diff <= 0) return "00:00:00";

        const horas = Math.floor(diff / 3600);
        diff = diff % 3600;
        const minutos = Math.floor(diff / 60);
        const segundos = Math.floor(diff % 60);

        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(horas)}:${pad(minutos)}:${pad(segundos)}`;
    } catch (e) {
        return "-";
    }
}

function calcularDirecao(fundingRate) {
    if (fundingRate > 0) return "Long paga Short";
    if (fundingRate < 0) return "Short paga Long";
    return "Neutro";
}

function renderTable(linhas) {
    const tbody = fundingTable.querySelector("tbody");
    tbody.innerHTML = "";

    for (const info of linhas) {
        const tr = document.createElement("tr");

        const direcaoClass =
            info.direcao.includes("Long paga Short") ? "badge-long" :
            info.direcao.includes("Short paga Long") ? "badge-short" :
            "badge-neutro";

        tr.innerHTML = `
            <td>${info.symbol}</td>
            <td>${info.category}</td>
            <td>${info.funding_rate_pct.toFixed(6)}</td>
            <td><span class="${direcaoClass}">${info.direcao}</span></td>
            <td>${info.taxa_ciclo.toFixed(6)}</td>
            <td>${info.taxa_hora.toFixed(6)}</td>
            <td>${info.last_price}</td>
            <td>${info.index_price}</td>
            <td>${info.mark_price}</td>
            <td>${info.funding_interval_hour}</td>
            <td>${info.tempo_restante}</td>
            <td>${info.notional.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    }
}

function attachSortHandlers() {
    const cabecalhos = fundingTable.querySelectorAll("thead th");

    cabecalhos.forEach(th => {
        th.addEventListener("click", () => {
            const colIndex = parseInt(th.getAttribute("data-col"));
            const tipo = th.getAttribute("data-type") || "string";
            const tbody = fundingTable.querySelector("tbody");
            const linhas = Array.from(tbody.querySelectorAll("tr"));

            cabecalhos.forEach(h => {
                if (h !== th) {
                    h.classList.remove("sort-asc", "sort-desc");
                }
            });

            const estaAsc = th.classList.contains("sort-asc");
            const novoAsc = !estaAsc;
            th.classList.toggle("sort-asc", novoAsc);
            th.classList.toggle("sort-desc", !novoAsc);

            linhas.sort((a, b) => {
                const aText = a.children[colIndex].innerText.replace("%", "").trim();
                const bText = b.children[colIndex].innerText.replace("%", "").trim();

                let aVal = aText;
                let bVal = bText;

                if (tipo === "number") {
                    aVal = parseFloat(aText.replace(",", ".")) || 0;
                    bVal = parseFloat(bText.replace(",", ".")) || 0;
                } else {
                    aVal = aText.toLowerCase();
                    bVal = bText.toLowerCase();
                }

                if (aVal < bVal) return novoAsc ? -1 : 1;
                if (aVal > bVal) return novoAsc ? 1 : -1;
                return 0;
            });

            linhas.forEach(l => tbody.appendChild(l));
        });
    });
}

function startAutoRefresh() {
    stopAutoRefresh();
    remainingSeconds = REFRESH_SECONDS;
    infoNextRefresh.textContent = `${remainingSeconds}s`;

    countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
            remainingSeconds = REFRESH_SECONDS;
        }
        infoNextRefresh.textContent = `${remainingSeconds}s`;
    }, 1000);

    autoRefreshInterval = setInterval(() => {
        loadData(true);
        remainingSeconds = REFRESH_SECONDS;
    }, REFRESH_SECONDS * 1000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    infoNextRefresh.textContent = "-";
}

async function loadData(triggeredByAuto = false) {
    const notionalStr = notionalInput.value.trim();
    const notional = parseFloat(notionalStr.replace(",", "."));
    if (isNaN(notional) || notional <= 0) {
        alert("Informe um notional válido (ex: 1000).");
        return;
    }
    currentNotional = notional;

    statusText.textContent = triggeredByAuto
        ? "Atualizando automaticamente..."
        : "Buscando dados na Bybit...";
    btnAtualizar.disabled = true;

    const startTime = performance.now();

    try {
        const instrumentos = await fetchInstrumentsPerpetualUSDT();
        const tickersLinear = await fetchAllTickersLinear();

        const linhas = [];

        for (const inst of instrumentos) {
            const symbol = inst.symbol;
            const category = inst.category;

            const ticker = tickersLinear[symbol];
            if (!ticker) continue;

            const last_price = ticker.lastPrice ?? "-";
            const index_price = ticker.indexPrice ?? "-";
            const mark_price = ticker.markPrice ?? "-";
            const funding_rate_str = ticker.fundingRate ?? "0";
            const next_funding_time = ticker.nextFundingTime ?? "";
            const funding_interval_hour_str = ticker.fundingIntervalHour ?? "8";

            let funding_rate = parseFloat(funding_rate_str);
            if (isNaN(funding_rate)) funding_rate = 0;

            let funding_interval_hour = parseFloat(funding_interval_hour_str);
            if (isNaN(funding_interval_hour) || funding_interval_hour <= 0) {
                funding_interval_hour = 8.0;
            }

            const funding_rate_pct = funding_rate * 100.0;
            const direcao = calcularDirecao(funding_rate);
            const taxa_ciclo = notional * funding_rate;
            const taxa_hora = funding_interval_hour !== 0
                ? taxa_ciclo / funding_interval_hour
                : 0;
            const tempo_restante = formatarTempoRestante(next_funding_time);

            linhas.push({
                symbol,
                category,
                notional,
                funding_rate_pct,
                direcao,
                taxa_ciclo,
                taxa_hora,
                last_price,
                index_price,
                mark_price,
                funding_interval_hour,
                tempo_restante
            });
        }

        linhas.sort((a, b) => b.funding_rate_pct - a.funding_rate_pct);

        const endTime = performance.now();
        const elapsedSeconds = (endTime - startTime) / 1000.0;
        lastElapsedSeconds = elapsedSeconds;

        renderTable(linhas);
        infoBox.style.display = "flex";
        infoNotional.textContent = `${notional.toFixed(2)} USDT`;
        infoMoedas.textContent = String(linhas.length);
        infoTempo.textContent = `${elapsedSeconds.toFixed(2)} s`;
        statusText.textContent = `Atualizado com sucesso. Moedas: ${linhas.length}`;

        if (!triggeredByAuto) {
            startAutoRefresh();
        }
    } catch (e) {
        console.error(e);
        statusText.textContent = "Erro ao atualizar: " + e.message;
    } finally {
        btnAtualizar.disabled = false;
    }
}

btnAtualizar.addEventListener("click", () => loadData(false));

// Anexa handlers de ordenação ao carregar
attachSortHandlers();
