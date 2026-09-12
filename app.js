const state = {
  current: null,
  trends: null,
};

const charts = {
  primary: null,
  primaryWeek: null,
  secondaryWeek: null,
  secondary: null,
};

const AUTO_REFRESH_SECONDS = 60;
const DATA_BASE = window.CODEX_QUOTA_DATA_BASE || null;
let refreshTimer = null;

function fmtPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return `${Math.round(Number(value))}%`;
}

function fmtTime(epoch, withSeconds = false) {
  if (!epoch) {
    return "--";
  }
  return new Date(epoch * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
  });
}

function colorFor(value) {
  const numeric = Number(value);
  if (numeric < 20) return "var(--bad)";
  if (numeric < 50) return "var(--warn)";
  return "var(--good)";
}

function setMetric(prefix, value, resetAt) {
  const valueEl = document.getElementById(`${prefix}-value`);
  const meterEl = document.getElementById(`${prefix}-meter`);
  const resetEl = document.getElementById(`${prefix}-reset`);
  const hasValue = value !== null && value !== undefined && !Number.isNaN(Number(value));
  const bounded = hasValue ? Math.max(0, Math.min(100, Number(value))) : 0;
  const statusColor = hasValue ? colorFor(bounded) : "var(--muted)";

  valueEl.textContent = fmtPercent(value);
  valueEl.style.color = statusColor;
  meterEl.style.width = `${bounded}%`;
  meterEl.style.background = hasValue ? statusColor : "transparent";
  resetEl.textContent = `reset ${fmtTime(resetAt)}`;
}

function renderCurrent(sample) {
  if (!sample) {
    setMetric("primary", null, null);
    setMetric("secondary", null, null);
    document.getElementById("last-updated").textContent = "No samples yet";
    return;
  }

  setMetric("primary", sample.primary_remaining, sample.primary_reset_at);
  setMetric("secondary", sample.secondary_remaining, sample.secondary_reset_at);
  document.getElementById("last-updated").textContent =
    `Last updated ${fmtTime(sample.sampled_at, true)}`;
}

function ensureChart(name, id) {
  if (!charts[name]) {
    charts[name] = echarts.init(document.getElementById(id), null, { renderer: "canvas" });
  }
  return charts[name];
}

function chartData(points) {
  return [...points]
    .sort((a, b) => a.sampled_at - b.sampled_at)
    .map((point) => [point.sampled_at * 1000, Number(point.value)]);
}

function tooltipFormatter(params) {
  const item = Array.isArray(params) ? params.find((p) => p.value && p.value[1] !== null) : params;
  if (!item || !item.value || item.value[1] === null) {
    return "";
  }
  const time = new Date(item.value[0]).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `<div class="echarts-tooltip"><strong>${item.seriesName}</strong><br>${time}<br>${Math.round(item.value[1])}% left</div>`;
}

function chartOption(title, points, color, windowMs) {
  const now = Date.now();
  const minTime = now - windowMs;

  return {
    animation: false,
    color: [color],
    grid: {
      left: 48,
      right: 22,
      top: 24,
      bottom: 42,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      formatter: tooltipFormatter,
      confine: true,
    },
    xAxis: {
      type: "time",
      min: minTime,
      max: now,
      axisLabel: {
        color: "#667085",
      },
      axisLine: {
        lineStyle: { color: "#c7cfdb" },
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      interval: 10,
      axisLabel: {
        color: "#667085",
        formatter: "{value}%",
      },
      splitLine: {
        lineStyle: { color: "#edf0f5" },
      },
    },
    series: [
      {
        name: title,
        type: "line",
        data: chartData(points),
        connectNulls: true,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: {
          width: 2.5,
        },
        itemStyle: {
          borderWidth: 1.5,
          borderColor: "#ffffff",
        },
        areaStyle: {
          opacity: 0.08,
        },
        label: {
          show: false,
        },
        emphasis: {
          focus: "series",
          scale: true,
        },
      },
    ],
    graphic: points.length
      ? []
      : [
          {
            type: "text",
            left: "center",
            top: "middle",
            style: {
              text: "No data yet",
              fill: "#667085",
              fontSize: 14,
            },
          },
        ],
  };
}

function renderCharts(trends) {
  ensureChart("primary", "primary-chart").setOption(
    chartOption("5h remaining", trends.primary_24h || [], "#2563eb", 24 * 3600 * 1000),
    true
  );
  ensureChart("primaryWeek", "primary-week-chart").setOption(
    chartOption("5h remaining", trends.primary_7d || [], "#6f4bd8", 7 * 86400 * 1000),
    true
  );
  ensureChart("secondaryWeek", "secondary-week-chart").setOption(
    chartOption("Weekly remaining", trends.secondary_7d || [], "#0f9f8f", 7 * 86400 * 1000),
    true
  );
  ensureChart("secondary", "secondary-chart").setOption(
    chartOption("Weekly remaining", trends.secondary_30d || [], "#14915f", 30 * 86400 * 1000),
    true
  );
}

function scheduleAutoRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = setTimeout(() => {
    load().catch((err) => {
      document.getElementById("last-updated").textContent = `Load failed: ${err}`;
      scheduleAutoRefresh();
    });
  }, AUTO_REFRESH_SECONDS * 1000);
}

async function load() {
  const [currentResp, trendsResp] = DATA_BASE
    ? await Promise.all([
        fetch(`${DATA_BASE}/current.json?t=${Date.now()}`),
        fetch(`${DATA_BASE}/trends.json?t=${Date.now()}`),
      ])
    : await Promise.all([
        fetch("/api/current"),
        fetch("/api/trends"),
      ]);
  state.current = await currentResp.json();
  state.trends = await trendsResp.json();
  renderCurrent(state.current.sample);
  renderCharts(state.trends);
  scheduleAutoRefresh();
}

document.getElementById("refresh").addEventListener("click", () => {
  load().catch((err) => {
    document.getElementById("last-updated").textContent = `Load failed: ${err}`;
  });
});

window.addEventListener("resize", () => {
  Object.values(charts).forEach((chart) => {
    if (chart) {
      chart.resize();
    }
  });
});

load().catch((err) => {
  document.getElementById("last-updated").textContent = `Load failed: ${err}`;
});
