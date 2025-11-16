// ⬅️ Troque essa URL quando subir o backend (Render, Vercel etc.)

const BACKEND_URL = "https://investimentos-sogc.onrender.com"; // render
//const BACKEND_URL = "http://127.0.0.1:8000"; // local


let autoRefreshInterval = null;
let countdownInterval = null;
const REFRESH_SECONDS = 30;
let remainingSeconds = REFRESH_SECONDS;

const statusText = document.getElementById("statusText");
const infoBox = document.getElementById("infoBox");
const infoNotional = document.getElementById("infoNotional");
const infoMoedas = document.getElementById("infoMoedas");
const infoTempo = document.getElementById("infoTempo");
const infoNextRefresh = document.getElementById("infoNextRefresh");
const fundingTable = document.getElementById("fundingTable");
const btnAtualizar = document.getElementById("btnAtualizar");
const notionalInput = document.getElementById("notionalInput");

function renderTable(linhas) {
    const tbody = fundingTable.querySelector("tbody");
    tbody.innerHTML = "";

    for (const info of linhas) {
        const tr = document.createElement("tr");

        const direcaoClass =
            info.direcao.includes("Long paga Short") ? "badge-long" :
            info.direcao.includes("Short paga Long") ? "badge-short" :
            "badge-neutro";

        const last = info.last_price !== null && info.last_price !== undefined ? info.last_price : "-";
        const index = info.index_price !== null && info.index_price !== undefined ? info.index_price : "-";
        const mark = info.mark_price !== null && info.mark_price !== undefined ? info.mark_price : "-";

        tr.innerHTML = `
            <td>${info.symbol}</td>
            <td>${info.category}</td>
            <td>${info.funding_rate_pct.toFixed(6)}</td>
            <td><span class="${direcaoClass}">${info.direcao}</span></td>
            <td>${info.taxa_ciclo.toFixed(6)}</td>
            <td>${info.taxa_hora.toFixed(6)}</td>
            <td>${last}</td>
            <td>${index}</td>
            <td>${mark}</td>
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

    statusText.textContent = triggeredByAuto
        ? "Atualizando automaticamente..."
        : "Buscando dados no backend...";
    btnAtualizar.disabled = true;

    const url = `${BACKEND_URL}/funding?notional=${encodeURIComponent(notional)}`;

    const start = performance.now();

    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${txt}`);
        }

        const json = await resp.json();
        const linhas = json.data || [];

        renderTable(linhas);
        infoBox.style.display = "flex";
        infoNotional.textContent = `${json.notional.toFixed(2)} USDT`;
        infoMoedas.textContent = String(json.count);
        infoTempo.textContent = `${json.elapsed_seconds.toFixed(2)} s`;
        statusText.textContent = `Atualizado com sucesso. Moedas: ${json.count}`;

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
attachSortHandlers();
