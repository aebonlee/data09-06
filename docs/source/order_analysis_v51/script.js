const ANALYZER_VERSION = 'v51';
document.addEventListener('DOMContentLoaded', () => { 
  const el = document.getElementById('analyzerVersion'); 
  if (el) el.textContent = ANALYZER_VERSION; 
});

(() => {
  'use strict';

  const savedTheme = localStorage.getItem('orderAnalysisTheme');
  if (savedTheme === 'dark') document.body.classList.add('dark-mode');
  const themeToggle = document.getElementById('themeToggle');
  function updateThemeButton(){
    const dark = document.body.classList.contains('dark-mode');
    themeToggle.textContent = dark ? '☀ 라이트모드' : '🌙 다크모드';
    themeToggle.setAttribute('aria-label', dark ? '라이트모드 전환' : '다크모드 전환');
  }
  updateThemeButton();
  themeToggle.addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('orderAnalysisTheme', dark ? 'dark' : 'light');
    updateThemeButton();
    if (currentReport) {
      try { renderMultiAnalysis(); } catch (e) {}
      try { renderMultiColorMap(); } catch (e) {}
    }
  });

  const EXPECTED_RPMS = [2000, 2100, 2200, 2300, 2400];
  const EXPECTED_POINTS = ['LL', 'LR', 'UL', 'UR'];
  const EXPECTED_DIRECTIONS = ['X', 'Y', 'Z'];

  const $ = (id) => document.getElementById(id);
  const dropZone = $('dropZone');
  const fileInput = $('fileInput');
  const selectButton = $('selectButton');
  const resetButton = $('resetButton');
  const status = $('status');
  const resultArea = $('resultArea');
  const csvUploadSection = $('csvUploadSection');
  const csvUploadToggle = $('csvUploadToggle');
  const csvCollapsedSummary = $('csvCollapsedSummary');
  let currentReport = null;

  selectButton.addEventListener('click', (event) => {
    event.stopPropagation();
    fileInput.click();
  });
  resetButton.addEventListener('click', (event) => {
    event.stopPropagation();
    resetView();
  });
  csvUploadToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const collapsed = csvUploadSection.classList.toggle('collapsed');
    csvUploadToggle.textContent = collapsed ? '업로드 영역 열기' : '업로드 영역 접기';
    csvUploadToggle.setAttribute('aria-expanded', String(!collapsed));
  });
  $('cancelCsvPreview').addEventListener('click', (event) => {
    event.stopPropagation();
    resetView();
  });
  $('confirmCsvAnalysis').addEventListener('click', () => {
    if (!currentReport) return;
    const errors = currentReport.issues.filter(i => i.level === 'error').length;
    if (errors > 0) return;
    $('csvPreview').classList.add('hidden');
    renderReport(currentReport);
    csvUploadSection.classList.add('collapsed');
    csvUploadToggle.textContent = '업로드 영역 열기';
    csvUploadToggle.setAttribute('aria-expanded', 'false');
    csvCollapsedSummary.textContent = `분석 파일: ${currentReport.fileName || '-'} · 분석 완료`;
    setStatus('CSV 인식 확인 완료: Order Analysis 및 Spectrum Map 분석 실행.', 'success');
  });
  dropZone.addEventListener('click', (event) => {
    if (event.target.tagName !== 'BUTTON') fileInput.click();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });
  ['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', event => {
    const file = event.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  $('downloadModelButton').addEventListener('click', downloadNormalizedModel);
  $('modelChannelSelect').addEventListener('change', refreshModelRpmOptions);
  $('modelRpmSelect').addEventListener('change', renderSelectedModel);
  $('copyJsonButton').addEventListener('click', copySelectedJson);
  $('orderChannelSelect').addEventListener('change', renderOrderAnalysis);
  $('orderInput').addEventListener('input', renderOrderAnalysis);
  $('peakSearchInput').addEventListener('input', renderOrderAnalysis);
  $('sumWidthInput').addEventListener('input', renderOrderAnalysis);
  $('matchToleranceInput').addEventListener('input', renderOrderAnalysis);
  $('mapMinFreq').addEventListener('input', renderColorMap);
  $('mapMaxFreq').addEventListener('input', renderColorMap);
  window.addEventListener('resize', debounce(() => { renderOrderCharts(); renderColorMap(); }, 100));
  ['multiOrderInput','multiSearchWidth','multiSumWidth','noiseOrderDbReference','vibrationSourceDbReference','vibrationOrderDbReference'].forEach(id => {
    $(id).addEventListener('input', () => { renderMultiAnalysis(); if(id==='multiSearchWidth') renderMultiColorMap(); });
  });
  function handleNoiseSourceDbReferenceChange() {
    rebuildNoiseNormalizedModel();
  }
  $('noiseSourceDbReference').addEventListener('input', handleNoiseSourceDbReferenceChange);
  $('noiseSourceDbReference').addEventListener('change', handleNoiseSourceDbReferenceChange);
  ['noiseAmplitudeMode','vibrationAmplitudeMode'].forEach(id => $(id).addEventListener('change', renderMultiAnalysis));
  $('showOverall').addEventListener('change', renderMultiAnalysis);
  $('showRssSum').addEventListener('change', renderMultiAnalysis);
  $('contributionChannelSelect').addEventListener('change', renderContributionAnalysis);
  $('downloadOrderAnalysisXlsx').addEventListener('click', downloadOrderAnalysisXlsx);
  $('selectAllChannels').addEventListener('click', () => { document.querySelectorAll('.multi-channel').forEach(x => x.checked=true); renderMultiAnalysis(); });
  $('clearChannels').addEventListener('click', () => { document.querySelectorAll('.multi-channel').forEach(x => x.checked=false); renderMultiAnalysis(); });
  window.addEventListener('resize', debounce(() => { renderMultiAnalysis(); fitCompactKpiText(); }, 120));
  $('combinedOrderCanvas').addEventListener('mousemove',event=>{if(!combinedPlotPoints.length||!combinedChartSelection)return;const rect=$('combinedOrderCanvas').getBoundingClientRect(),mx=event.clientX-rect.left,my=event.clientY-rect.top;let nearest=null,dmin=Infinity;for(const p of combinedPlotPoints){const d=Math.hypot(p.canvasX-mx,p.canvasY-my);if(d<dmin){nearest=p;dmin=d;}}combinedHoverPoint=dmin<=22?nearest:null;$('combinedOrderCanvas').style.cursor=combinedHoverPoint?'crosshair':'default';drawCombinedOrderChart(combinedChartSeries,combinedChartSelection);});
  $('combinedOrderCanvas').addEventListener('mouseleave',()=>{combinedHoverPoint=null;$('combinedOrderCanvas').style.cursor='default';if(combinedChartSelection)drawCombinedOrderChart(combinedChartSeries,combinedChartSelection);});
  ['graphRpmMin','graphRpmMax','graphAmpMin','graphAmpMax'].forEach(id => $(id).addEventListener('input', renderMultiAnalysis));
  
  $('mapChannelSelect').addEventListener('change', () => {
    const channel = currentReport?.normalized?.channels?.[$('mapChannelSelect').value];
    if (!channel) return;
    syncSpectrumMapToOrderAnalysis(channel, $('mapChannelSelect').value);
    initializeMapAxisInputs();
    if (mapXAxisMode === 'order') initializeMapOrderAxisInputs();
    else setMapFrequencyRangeFromData();
    updateMapColorAxisInputs();
    spectrumMapHover = null;
    spectrumMapGeometry = null;
    requestAnimationFrame(() => renderMultiColorMap());
  });
  $('mapMinFrequency').addEventListener('input', renderMultiColorMap);
  $('mapMaxFrequency').addEventListener('input', renderMultiColorMap);
  $('mapOrderOverlayInput').addEventListener('input', renderMultiColorMap);
  
  function setMapXAxisMode(mode) {
    mapXAxisMode = mode === 'order' ? 'order' : 'frequency';
    $('mapFrequencyAxisButton').classList.toggle('active', mapXAxisMode === 'frequency');
    $('mapOrderAxisButton').classList.toggle('active', mapXAxisMode === 'order');
    $('mapFrequencyAxisControlMin').classList.toggle('hidden', mapXAxisMode === 'order');
    $('mapFrequencyAxisControlMax').classList.toggle('hidden', mapXAxisMode === 'order');
    $('mapOrderAxisControlMin').classList.toggle('hidden', mapXAxisMode !== 'order');
    $('mapOrderAxisControlMax').classList.toggle('hidden', mapXAxisMode !== 'order');
    $('spectrumMapXAxisLabel').textContent = mapXAxisMode === 'order' ? 'Order Axis' : 'Frequency Axis';
    if (currentReport) {
      if (mapXAxisMode === 'order') initializeMapOrderAxisInputs();
      else setMapFrequencyRangeFromData();
      renderMultiColorMap();
    }
  }
  
  $('mapFrequencyAxisButton').addEventListener('click', () => setMapXAxisMode('frequency'));
  $('mapOrderAxisButton').addEventListener('click', () => setMapXAxisMode('order'));
  ['mapMinOrder','mapMaxOrder'].forEach(id => $(id).addEventListener('input', renderMultiColorMap));
  $('mapOrderOverlayEnabled').addEventListener('change', () => {
    const enabled = $('mapOrderOverlayEnabled').checked;
    $('mapOrderOverlaySettings').classList.toggle('hidden', !enabled);
    renderMultiColorMap();
  });
  ['mapRpmMin','mapRpmMax','mapAmpMin','mapAmpMax'].forEach(id => $(id).addEventListener('input', renderMultiColorMap));
  $('multiColorMapCanvas').addEventListener('mousemove', event => {
    const rect=$('multiColorMapCanvas').getBoundingClientRect();
    spectrumMapHover={x:event.clientX-rect.left,y:event.clientY-rect.top};
    $('multiColorMapCanvas').style.cursor='crosshair';
    renderMultiColorMap();
  });
  $('multiColorMapCanvas').addEventListener('mouseleave', () => {
    spectrumMapHover=null;
    $('multiColorMapCanvas').style.cursor='default';
    renderMultiColorMap();
  });
  window.addEventListener('resize', debounce(renderMultiColorMap, 120));

  function setStatus(message, type = '', loading = false) {
    status.className = 'status-line' + (type ? ' ' + type : '');
    status.innerHTML = loading ? '<span class="spinner"></span><span>' + escapeHtml(message) + '</span>' : escapeHtml(message);
  }

  function resetView() {
    fileInput.value = '';
    currentReport = null;
    resultArea.classList.add('hidden');
    $('csvPreview').classList.add('hidden');
    csvUploadSection.classList.remove('collapsed');
    csvUploadToggle.textContent = '업로드 영역 접기';
    csvUploadToggle.setAttribute('aria-expanded', 'true');
    csvCollapsedSummary.textContent = '';
    $('csvPreviewSummary').innerHTML = '';
    $('csvPreviewChecks').innerHTML = '';
    $('csvPreviewBody').innerHTML = '';
    resetButton.classList.add('hidden');
    setStatus('분석할 CSV 파일을 선택하십시오.');
  }

  async function handleFile(file) {
    resultArea.classList.add('hidden');
    csvUploadSection.classList.remove('collapsed');
    csvUploadToggle.textContent = '업로드 영역 접기';
    csvUploadToggle.setAttribute('aria-expanded', 'true');
    csvCollapsedSummary.textContent = `선택 파일: ${file.name}`;
    $('csvPreview').classList.add('hidden');
    resetButton.classList.remove('hidden');

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setStatus('CSV 확장자 파일만 선택 가능.', 'error');
      return;
    }

    setStatus('파일을 읽고 구조 확인 중.', '', true);
    try {
      const buffer = await file.arrayBuffer();
      const decoded = decodeCsvBuffer(buffer);
      const rows = parseCsv(decoded.text);
      const report = analyzeStructure(rows, file, decoded.encoding);
      currentReport = report;
      renderCsvPreview(report);
      const errorCount = report.issues.filter(i => i.level === 'error').length;
      const warningCount = report.issues.filter(i => i.level === 'warning').length;
      $('confirmCsvAnalysis').disabled = errorCount > 0;
      $('csvPreview').classList.remove('hidden');
      if (errorCount > 0) {
        setStatus(`CSV 인식 확인 필요: 오류 ${errorCount}건, 경고 ${warningCount}건`, 'error');
      } else if (warningCount > 0) {
        setStatus(`CSV 인식 완료: 경고 ${warningCount}건. 내용을 확인한 후 분석 실행.`, 'warning');
      } else {
        setStatus('CSV 인식 완료: 내용 확인 후, 분석 실행.', 'success');
      }
    } catch (error) {
      console.error(error);
      currentReport = null;
      $('csvPreview').classList.add('hidden');
      setStatus('파일 처리 실패: ' + error.message, 'error');
    }
  }

  function renderCsvRecognitionSignal(report) {
    const errorCount = report.issues.filter(i => i.level === 'error').length;
    const warningCount = report.issues.filter(i => i.level === 'warning').length;
    const lights = { green: $('csvSignalGreen'), yellow: $('csvSignalYellow'), red: $('csvSignalRed') };
    Object.values(lights).forEach(el => el.classList.remove('active'));
    const signal = errorCount > 0 ? 'red' : (warningCount > 0 ? 'yellow' : 'green');
    lights[signal].classList.add('active');
    $('csvSignalText').textContent = signal === 'red' ? 'CSV 인식 오류' : signal === 'yellow' ? 'CSV 인식 확인 필요' : 'CSV 정상 인식';
    $('csvSignalDetail').textContent = errorCount > 0 ? `오류 ${errorCount}건 · 분석 실행 전 확인 필요` : warningCount > 0 ? `경고 ${warningCount}건 · 내용을 확인한 후 분석 실행 가능` : `오류/경고 없음 · ${report.curveCount}개 Curve 정상 인식`;
  }

  function renderCsvPreview(report) {
    renderCsvRecognitionSignal(report);
    $('csvPreviewFileName').innerHTML = `<span class="file-label">파일명</span><span class="file-value">${escapeHtml(String(report.fileName || '-'))}</span>`;
    const items = [
      ['인코딩', report.encoding], ['전체 행 / 최대 열', `${report.rows} /${report.maxColumns}`],
      ['Curve 수', `${report.curveCount}개`], ['채널 수', `${report.channelCount}개`],
      ['측정 방향', report.directions.join(', ') || '인식 없음'],
      ['주파수 범위', `${formatNumber(report.minFrequency)} ~${formatNumber(report.maxFrequency)} Hz`], ['주파수 간격', `${formatNumber(report.resolution)} Hz`]
    ];
    $('csvPreviewSummary').innerHTML = items.map(([label,value]) =>
      `<div class="summary-item"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(String(value))}</span></div>`
    ).join('');
    $('csvPreviewChecks').innerHTML = `<ul class="check-list">${report.checks.map(c => {
      const type = c.ok ? 'ok' : 'warn'; const symbol = c.ok ? '✓' : '!';
      return `<li><span class="check-symbol ${type}-text">${symbol}</span><div><strong>${escapeHtml(c.text)}</strong><div class="small">${escapeHtml(c.detail)}</div></div></li>`;
    }).join('')}</ul>`;
    $('csvPreviewBody').innerHTML = report.curves.slice(0, 80).map(c => {
      const valid = Number.isFinite(c.rpm) && c.dataCount > 0 && c.monotonic;
      const channel = c.channelType === 'noise' ? c.point : `${c.point || '-'}${c.direction || ''}`.trim();
      return `<tr><td>${escapeHtml(String(c.curveNo))}</td><td>${escapeHtml(Number.isFinite(c.rpm) ? String(c.rpm) : '미인식')}</td><td>${escapeHtml(channel || '-')}</td><td>${escapeHtml(c.point || '-')}</td><td>${escapeHtml(c.direction || '-')}</td><td>${escapeHtml(c.yUnit || c.physicalUnit || '-')}</td><td class="num">${escapeHtml(String(c.dataCount))}</td><td>${escapeHtml(`${formatNumber(c.minFrequency)} ~ ${formatNumber(c.maxFrequency)}`)}</td><td><span class="badge ${valid ? 'ok' : 'error'}">${valid ? '정상' : '확인 필요'}</span></td></tr>`;
    }).join('');
    $('csvPreviewNote').textContent = report.curves.length > 80
      ? `전체 ${report.curves.length}개 Curve 중 처음 80개를 표시합니다. 분석 실행 시 전체 Curve를 사용합니다.`
      : '표시된 Curve의 RPM, 채널, 방향, 단위, 데이터 수, 주파수 범위를 확인하십시오. 경고는 사용자가 내용을 확인한 후 분석을 진행할 수 있습니다.';
  }

  function decodeCsvBuffer(buffer) {
    const candidates = [
      { label: 'UTF-8', name: 'utf-8' },
      { label: 'CP949/EUC-KR', name: 'euc-kr' }
    ];
    for (const candidate of candidates) {
      try {
        const text = new TextDecoder(candidate.name, { fatal: true }).decode(buffer);
        return { text: text.replace(/^\uFEFF/, ''), encoding: candidate.label };
      } catch (_) { }
    }
    try {
      const text = new TextDecoder('euc-kr').decode(buffer);
      return { text: text.replace(/^\uFEFF/, ''), encoding: 'CP949/EUC-KR (대체문자 허용)' };
    } catch (_) {
      throw new Error('UTF-8 또는 CP949/EUC-KR 형식으로 파일을 해석할 수 없습니다.');
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
      } else {
        if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch !== '\r') field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
    return rows;
  }

  function safeMin(values) {
    let result = Infinity;
    for (const value of values) if (Number.isFinite(value) && value < result) result = value;
    return result;
  }
  function safeMax(values) {
    let result = -Infinity;
    for (const value of values) if (Number.isFinite(value) && value > result) result = value;
    return result;
  }

  function analyzeStructure(rows, file, encoding) {
    if (!rows.length) throw new Error('CSV에 데이터가 없습니다.');
    const maxColumns = safeMax(rows.map(r => r.length));
    const header = rows[0] || [];

    const pairedCurvePairs = [];
    for (let col = 0; col < header.length; col += 2) {
      const match = String(header[col] || '').trim().match(/^Curve\s+(\d+)$/i);
      if (match) pairedCurvePairs.push({ curveNo: Number(match[1]), xCol: col, yCol: col + 1 });
    }

    const sharedAxisFormat = pairedCurvePairs.length <= 1 && maxColumns > 2;
    let curvePairs = pairedCurvePairs;
    let dataStartIndex = -1;

    if (sharedAxisFormat) {
      dataStartIndex = rows.findIndex((row, index) =>
        index > 0 && isFiniteNumber(row[0]) && row.slice(1).some(isFiniteNumber)
      );
      if (dataStartIndex < 0) throw new Error('공통 주파수 축과 진폭 데이터의 시작 행을 찾지 못했습니다.');

      const numericAmplitudeColumns = new Set();
      for (let r = dataStartIndex; r < rows.length; r++) {
        const row = rows[r];
        for (let col = 1; col < Math.min(row.length, maxColumns); col++) {
          if (isFiniteNumber(row[col])) numericAmplitudeColumns.add(col);
        }
        if (numericAmplitudeColumns.size === maxColumns - 1) break;
      }
      curvePairs = [...numericAmplitudeColumns]
        .sort((a, b) => a - b)
        .map(col => ({ curveNo: col, xCol: 0, yCol: col }));
      if (!curvePairs.length) throw new Error('공통 주파수 축 뒤에서 숫자 진폭 열을 찾지 못했습니다.');
    } else {
      if (!curvePairs.length) throw new Error('첫 행에서 Curve 열을 찾지 못했습니다.');
      dataStartIndex = rows.findIndex((row, index) =>
        index > 0 && curvePairs.every(pair => isFiniteNumber(row[pair.xCol]) && isFiniteNumber(row[pair.yCol]))
      );
      if (dataStartIndex < 0) throw new Error('모든 Curve가 숫자로 구성된 스펙트럼 데이터 시작 행을 찾지 못했습니다.');
    }

    const metadataRows = rows.slice(1, dataStartIndex);
    const metadataMaps = curvePairs.map(pair => {
      const map = new Map();
      for (const row of metadataRows) {
        const key = normalizeMetaKey(row[sharedAxisFormat ? 0 : pair.xCol]);
        const value = String(row[pair.yCol] ?? '').trim();
        if (key) map.set(key, value);
      }
      return map;
    });

    const curves = curvePairs.map((pair, idx) => {
      const meta = metadataMaps[idx];
      const frequency = [], amplitude = [];
      let invalidCount = 0;
      for (let r = dataStartIndex; r < rows.length; r++) {
        const x = toNumber(rows[r][pair.xCol]);
        const y = toNumber(rows[r][pair.yCol]);
        if (Number.isFinite(x) && Number.isFinite(y)) { frequency.push(x); amplitude.push(y); }
        else if (String(rows[r][pair.yCol] ?? '').trim() !== '') invalidCount++;
      }
      const datasetName = getMeta(meta, ['Standard\\All\\Dataset name', 'Dataset name', 'Dataset']).trim();
      const legacyRunName = getMeta(meta, ['Standard\\All\\Run name', 'Run name', 'Standard\\All\\Original run']).trim();
      const runName = datasetName || legacyRunName;
      const rpmMatch = String(runName).match(/RPM\s*[_-]?\s*(\d{2,6})/i) || String(runName).match(/(?:^|[^0-9])(\d{3,6})(?:[^0-9]|$)/);
      const dofId = getMeta(meta, ['Standard\\All\\DOF id', 'DOF id', 'DOF ID', 'Dof id']).trim();
      const legacyPoint = getMeta(meta, ['Standard\\All\\Point id', 'Point id']).trim();
      const legacyDirection = getMeta(meta, ['Standard\\All\\Point direction absolute', 'Standard\\All\\Point direction', 'Point direction']).trim();
      const dofDirectionMatch = dofId.match(/([+-]?)\s*([XYZ])\s*$/i);
      const point = dofId ? dofId.replace(/\s*:?\s*[+-]?\s*[XYZ]\s*$/i, '').trim() : legacyPoint;
      const directionRaw = dofDirectionMatch ? dofDirectionMatch[2] : legacyDirection;
      const parsedDirection = String(directionRaw).replace(/[^XYZxyz]/g, '').toUpperCase().slice(0, 1);
      const physicalUnit = getMeta(meta, ['Standard\\All\\Y axis unit', 'Y axis unit']);
      const scaleText = String(rows[dataStartIndex - 1]?.[pair.yCol] ?? '').trim();
      const inputScale = isDbScaleUnit(scaleText) ? normalizeAmplitudeUnit(scaleText) : 'linear';
      const yUnit = inputScale === 'linear' ? physicalUnit : (inputScale === 'dba' || inputScale === 'db(a)' ? 'dBA' : 'dB');
      const channelType = normalizeAmplitudeUnit(physicalUnit) === 'pa' || isDbScaleUnit(yUnit) ? 'noise' : 'vibration';
      const direction = channelType === 'noise' ? '' : parsedDirection;
      const steps = [];
      for (let i = 1; i < frequency.length; i++) steps.push(frequency[i] - frequency[i - 1]);
      const resolution = steps.length ? median(steps) : NaN;
      const monotonic = steps.every(v => v > 0);
      return {
        curveNo: pair.curveNo, xCol: pair.xCol, yCol: pair.yCol,
        rpm: rpmMatch ? Number(rpmMatch[1]) : null, runName, datasetName, dofId, point, direction, channelType, physicalUnit, inputScale,
        label: getMeta(meta, ['Standard\\All\\label', 'label']),
        xUnit: getMeta(meta, ['Standard\\All\\X axis unit', 'X axis unit']),
        yUnit,
        dataCount: frequency.length,
        minFrequency: frequency.length ? safeMin(frequency) : NaN,
        maxFrequency: frequency.length ? safeMax(frequency) : NaN,
        resolution, monotonic, invalidCount, frequency, amplitude
      };
    });

    const issues = [];
    const checks = [];
    addCheck(checks, curves.length > 0, `Curve 수: ${curves.length}개`, '숫자 진폭 데이터가 있는 Curve가 1개 이상이어야 함');
    addCheck(checks, sharedAxisFormat ? maxColumns === curves.length + 1 : maxColumns === curvePairs.length * 2,
      `최대 열 수: ${maxColumns}개`, sharedAxisFormat ? `공통 주파수 1열 + 진폭 ${curves.length}열` : `Curve당 X/Y 2열`);
    addCheck(checks, dataStartIndex >= 0, `숫자 데이터 시작 행: ${dataStartIndex + 1}행`, '숫자 주파수와 진폭이 함께 시작되는 행');

    const rpms = uniqueSorted(curves.map(c => c.rpm).filter(Number.isFinite));
    const points = uniqueSorted(curves.map(c => c.point).filter(Boolean));
    const directions = uniqueSorted(curves.map(c => c.direction).filter(Boolean));
    addCheck(checks, rpms.length > 0, `RPM 조건: ${rpms.join(', ') || '인식 실패'}`, 'Run 메타데이터에서 RPM이 1개 이상 인식되어야 함');
    addCheck(checks, points.length > 0, `측정 위치: ${points.join(', ') || '인식 실패'}`, 'Point id가 1개 이상 인식되어야 함');
    addCheck(checks, directions.length > 0, `측정 방향: ${directions.join(', ') || '인식 실패'}`, 'X/Y/Z 방향이 1개 이상 인식되어야 함');

    const counts = curves.map(c => c.dataCount);
    const commonCount = mode(counts);
    addCheck(checks, curves.every(c => c.dataCount === commonCount), `Curve별 데이터 수: 대표값 ${commonCount}개`, '모든 Curve의 데이터 수가 같아야 함');
    addCheck(checks, curves.every(c => nearlyEqual(c.minFrequency, mode(curves.map(x => x.minFrequency)))), `최소 주파수: 대표값 ${formatNumber(mode(curves.map(c => c.minFrequency)))} Hz`, '모든 Curve의 최소 주파수가 같아야 함');
    addCheck(checks, curves.every(c => nearlyEqual(c.maxFrequency, mode(curves.map(x => x.maxFrequency)))), `최대 주파수: 대표값 ${formatNumber(mode(curves.map(c => c.maxFrequency)))} Hz`, '모든 Curve의 최대 주파수가 같아야 함');
    addCheck(checks, curves.every(c => nearlyEqual(c.resolution, mode(curves.map(x => round(x.resolution, 9))))), `주파수 간격: 대표값 ${formatNumber(mode(curves.map(c => round(c.resolution, 9))))} Hz`, '모든 Curve의 주파수 간격이 같아야 함');
    addCheck(checks, curves.every(c => c.monotonic), '주파수 축 오름차순 여부', '모든 Curve가 오름차순이어야 함');

    const mapping = new Map();
    curves.forEach(c => {
      const key = `${c.point}|${c.channelType === 'noise' ? 'N/A' : c.direction}`;
      if (!mapping.has(key)) mapping.set(key, new Map());
      const rpmMap = mapping.get(key);
      if (rpmMap.has(c.rpm)) issues.push({ level: 'error', message: `${c.point} ${c.direction}, ${c.rpm} rpm 조합이 중복됩니다.` });
      rpmMap.set(c.rpm, c);
      if (!c.rpm || !c.point || (c.channelType === 'vibration' && !c.direction)) issues.push({ level: 'error', message: `Curve ${c.curveNo}: RPM/위치${c.channelType === 'vibration' ? '/방향' : ''} 메타데이터 중 일부를 읽지 못했습니다.` });
      if (!c.dataCount) issues.push({ level: 'error', message: `Curve ${c.curveNo}: 숫자 스펙트럼 데이터가 없습니다.` });
      if (c.invalidCount) issues.push({ level: 'warning', message: `Curve ${c.curveNo}: 숫자로 변환되지 않은 데이터 행이 ${c.invalidCount}개 있습니다.` });
      if (!c.monotonic) issues.push({ level: 'error', message: `Curve ${c.curveNo}: 주파수 축이 오름차순이 아닙니다.` });
      if (c.xUnit && c.xUnit.toLowerCase() !== 'hz') issues.push({ level: 'warning', message: `Curve ${c.curveNo}: X축 단위가 Hz가 아닙니다 (${c.xUnit}).` });
      if (c.yUnit && !['g','pa','db','dba','db(a)'].includes(c.yUnit.trim().toLowerCase())) issues.push({ level: 'warning', message: `Curve ${c.curveNo}: 지원 단위(g, Pa, dB, dBA)가 아닙니다 (${c.yUnit}).` });
    });

    // 실제 채널별 RPM 완전성만 검사합니다. 소음 채널은 방향 조합 검사에서 제외합니다.
    for (const [channelKey, rpmMap] of mapping.entries()) {
      const [point, directionKey] = channelKey.split('|');
      const channelLabel = directionKey === 'N/A' ? `${point} [소음]` : `${point} ${directionKey} [진동]`;
      for (const rpm of rpms) {
        if (!rpmMap.has(rpm)) issues.push({ level: 'warning', message: `${channelLabel}, ${rpm} rpm Curve가 없습니다.` });
      }
    }

    checks.filter(c => !c.ok).forEach(c => issues.push({ level: 'warning', message: `${c.text}. ${c.detail}` }));
    const normalized = buildNormalizedModel(curves, file.name, encoding);

    return {
      fileName: file.name, fileSize: file.size, encoding,
      layout: sharedAxisFormat ? '공통 주파수 축 + 다중 진폭 열' : 'Curve별 X/Y 반복 열',
      rows: rows.length, maxColumns, curveCount: curves.length,
      channelCount: new Set(curves.map(c => `${c.point}|${c.channelType === 'noise' ? 'N/A' : c.direction}`)).size,
      dataStartRow: dataStartIndex + 1,
      rpms, points, directions, curves, mapping, checks, issues,
      xUnit: mode(curves.map(c => c.xUnit).filter(Boolean)) || '-',
      yUnit: mode(curves.map(c => c.yUnit).filter(Boolean)) || '-',
      dataCount: commonCount,
      minFrequency: mode(curves.map(c => c.minFrequency)),
      maxFrequency: mode(curves.map(c => c.maxFrequency)),
      resolution: mode(curves.map(c => round(c.resolution, 9))),
      normalized
    };
  }

  function applyFrequencyInputStep(resolution){const step=Number.isFinite(resolution)&&resolution>0?resolution:1;['multiSearchWidth','multiSumWidth','peakSearchInput','sumWidthInput','matchToleranceInput','mapMinFrequency','mapMaxFrequency','mapMinFreq','mapMaxFreq'].forEach(id=>{const el=$(id);if(el)el.step=String(step);});}

  function renderReport(report) {
    applyFrequencyInputStep(report.resolution);
    renderMultiWorkspace(report);
    renderSummary(report);
    renderChecks(report.checks);
    renderMapping(report);
    renderCurves(report.curves);
    renderNormalizedModel(report);
    renderOrderSection(report);
    renderIssues(report.issues);
    resultArea.classList.remove('hidden');
  }

  function renderSummary(r) {
    const items = [
      ['파일명', r.fileName], ['파일 크기', formatBytes(r.fileSize)], ['인코딩', r.encoding],
      ['전체 행 / 최대 열', `${r.rows} / ${r.maxColumns}`], ['Curve 수', `${r.curveCount}개`],
      ['채널 수', `${r.channelCount}개`], ['RPM', r.rpms.join(', ')], ['측정 위치', r.points.join(', ')],
      ['측정 방향', r.directions.join(', ')], ['숫자 데이터 시작', `${r.dataStartRow}행`],
      ['주파수 범위', `${formatNumber(r.minFrequency)} ~ ${formatNumber(r.maxFrequency)} Hz`],
      ['주파수 간격', `${formatNumber(r.resolution)} Hz`], ['Curve당 데이터', `${r.dataCount}개`],
      ['X축 / Y축 단위', `${r.xUnit} / ${r.yUnit}`]
    ];
    $('summaryGrid').innerHTML = items.map(([label, value]) =>
      `<div class="summary-item"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(String(value))}</span></div>`
    ).join('');
  }

  function renderChecks(checks) {
    $('checkList').innerHTML = checks.map(c => {
      const type = c.ok ? 'ok' : 'warn';
      const symbol = c.ok ? '✓' : '!';
      return `<li><span class="check-symbol ${type}-text">${symbol}</span><div><strong>${escapeHtml(c.text)}</strong><div class="small">${escapeHtml(c.detail)}</div></div></li>`;
    }).join('');
  }

  function renderMapping(report) {
    $('mappingHead').innerHTML = '<tr><th>위치</th><th>방향</th>' + report.rpms.map(rpm => `<th class="num">${rpm} rpm</th>`).join('') + '<th>상태</th></tr>';
    const rows = [];
    for (const point of EXPECTED_POINTS) {
      for (const direction of EXPECTED_DIRECTIONS) {
        const rpmMap = report.mapping.get(`${point}|${direction}`) || new Map();
        const complete = report.rpms.every(rpm => rpmMap.has(rpm));
        rows.push(`<tr><td><strong>${point}</strong></td><td>${direction}</td>` + report.rpms.map(rpm => {
          const c = rpmMap.get(rpm);
          return `<td class="num">${c ? 'Curve ' + c.curveNo : '<span class="error-text">누락</span>'}</td>`;
        }).join('') + `<td><span class="badge ${complete ? 'ok' : 'error'}">${complete ? '정상' : '확인 필요'}</span></td></tr>`);
      }
    }
    $('mappingBody').innerHTML = rows.join('');
  }

  function renderCurves(curves) {
    $('curveBody').innerHTML = curves.map(c => {
      const ok = c.rpm && c.point && (c.channelType === 'noise' || c.direction) && c.dataCount > 0 && c.monotonic && c.invalidCount === 0;
      return `<tr>
        <td class="num">${c.curveNo}</td><td>${c.rpm ?? '-'}</td><td>${escapeHtml(c.point || '-')}</td><td>${escapeHtml(c.direction || '-')}</td>
        <td>${escapeHtml(c.label || '-')}</td><td>${escapeHtml(c.xUnit || '-')}</td><td>${escapeHtml(c.yUnit || '-')}</td>
        <td class="num">${c.dataCount}</td><td class="num">${formatNumber(c.minFrequency)}</td><td class="num">${formatNumber(c.maxFrequency)}</td>
        <td class="num">${formatNumber(c.resolution)}</td><td><span class="badge ${ok ? 'ok' : 'warn'}">${ok ? '정상' : '확인 필요'}</span></td>
      </tr>`;
    }).join('');
  }

  function renderIssues(issues) {
    if (!issues.length) {
      $('issueArea').innerHTML = '<div class="status-line success">발견된 경고 또는 오류가 없습니다.</div>';
      return;
    }
    $('issueArea').innerHTML = '<ul class="check-list">' + issues.map(issue => {
      const cls = issue.level === 'error' ? 'error' : 'warn';
      return `<li><span class="check-symbol ${cls}-text">${issue.level === 'error' ? '×' : '!'}</span><div>${escapeHtml(issue.message)}</div></li>`;
    }).join('') + '</ul>';
  }

  function noiseDbToPa(amplitude, frequency, sourceDbReference, sourceUnit) {
    if (!Number.isFinite(amplitude)) return NaN;
    const ref = Number(sourceDbReference);
    if (!(ref > 0) || !Number.isFinite(ref)) return NaN;
    const nativeDba = isDbaUnit(sourceUnit);
    const soundLevelDb = nativeDba ? amplitude - aWeighting(frequency) : amplitude;
    const pa = ref * Math.pow(10, soundLevelDb / 20);
    return Number.isFinite(pa) && pa >= 0 ? pa : NaN;
  }

  function buildNormalizedModel(curves, fileName, encoding) {
    const channels = {};
    const noiseSourceDbReference = Number($('noiseSourceDbReference')?.value);
    for (const curve of curves) {
      const channelId = curve.channelType === 'noise' ? curve.point : `${curve.point}_${curve.direction}`;
      if (!channels[channelId]) {
        channels[channelId] = {
          channelId,
          point: curve.point,
          direction: curve.direction,
          channelType: curve.channelType,
          label: curve.label,
          spectraByRpm: {}
        };
      }

      const isNoiseDb = curve.channelType === 'noise' && isDbScaleUnit(curve.yUnit);
      const originalAmplitude = curve.amplitude.slice();
      const normalizedAmplitude = isNoiseDb
        ? originalAmplitude.map((value, i) => noiseDbToPa(value, curve.frequency[i], noiseSourceDbReference, curve.yUnit))
        : originalAmplitude.slice();

      channels[channelId].spectraByRpm[String(curve.rpm)] = {
        curveNo: curve.curveNo,
        rpm: curve.rpm,
        xUnit: curve.xUnit,
        yUnit: isNoiseDb ? 'Pa' : curve.yUnit,
        physicalUnit: isNoiseDb ? 'Pa' : curve.physicalUnit,
        inputScale: isNoiseDb ? 'linear' : curve.inputScale,
        sourceUnit: curve.yUnit,
        sourceInputScale: curve.inputScale,
        sourceDbReference: isNoiseDb && Number.isFinite(noiseSourceDbReference) ? noiseSourceDbReference : null,
        sampleCount: curve.dataCount,
        minFrequency: curve.minFrequency,
        maxFrequency: curve.maxFrequency,
        frequencyResolution: curve.resolution,
        frequency: curve.frequency.slice(),
        // Noise dB/dBA 원본은 절대 덮어쓰지 않고 별도 배열로 보존합니다.
        originalAmplitude,
        amplitude: normalizedAmplitude
      };
    }
    return {
      schemaVersion: '2.2',
      source: { fileName, encoding },
      noiseNormalization: {
        enabled: true,
        sourceDbReference: Number.isFinite(noiseSourceDbReference) ? noiseSourceDbReference : null,
        internalUnit: 'Pa',
        rule: 'Noise dB/dBA input is preserved as originalAmplitude and converted to Pa when the source dB reference is applied or changed.'
      },
      axes: {
        xQuantity: 'Frequency',
        xUnit: mode(curves.map(c => c.xUnit).filter(Boolean)) || '',
        yQuantity: 'Amplitude',
        yUnit: mode(curves.map(c => c.channelType === 'noise' ? 'Pa' : c.yUnit).filter(Boolean)) || ''
      },
      rpmConditions: uniqueSorted(curves.map(c => c.rpm).filter(Number.isFinite)),
      channelOrder: Object.keys(channels).sort((a,b) => {
        const ca=channels[a], cb=channels[b];
        const ta=ca.channelType==='noise'?0:1, tb=cb.channelType==='noise'?0:1;
        return ta-tb || a.localeCompare(b);
      }),
      channels
    };
  }

  function rebuildNoiseNormalizedModel() {
    if (!currentReport) return;
    const hasNoiseDb = hasDbInputForType(currentReport, 'noise');
    if (!hasNoiseDb) {
      renderMultiWorkspace(currentReport);
      return;
    }

    const sourceRef = Number($('noiseSourceDbReference').value);
    if (!(sourceRef > 0) || !Number.isFinite(sourceRef)) return;

    // 기존 정규화 모델을 재사용하여 Noise만 다시 계산합니다.
    // Vibration 데이터와 채널 선택 상태는 그대로 유지합니다.
    const normalized = currentReport.normalized;
    if (!normalized) return;

    for (const curve of currentReport.curves) {
      if (curve.channelType !== 'noise' || !isDbScaleUnit(curve.yUnit)) continue;
      const channelId = curve.point;
      const spectrum = normalized.channels[channelId]?.spectraByRpm[String(curve.rpm)];
      if (!spectrum) continue;

      const originalAmplitude = curve.amplitude.slice();
      spectrum.originalAmplitude = originalAmplitude;
      spectrum.amplitude = originalAmplitude.map((value, i) =>
        noiseDbToPa(value, curve.frequency[i], sourceRef, curve.yUnit)
      );
      spectrum.sourceDbReference = sourceRef;
      spectrum.yUnit = 'Pa';
      spectrum.physicalUnit = 'Pa';
      spectrum.inputScale = 'linear';
    }

    normalized.noiseNormalization.sourceDbReference = sourceRef;
    updateInputDbReferencePanels(currentReport);
    initializeMapChannelOptions(currentReport);
    renderMultiAnalysis();
    renderOrderSection(currentReport);
  }

  function renderNormalizedModel(report) {
    const channelSelect = $('modelChannelSelect');
    channelSelect.innerHTML = report.normalized.channelOrder.map(id => {
      const ch = report.normalized.channels[id];
      return `<option value="${escapeHtml(id)}">${escapeHtml(channelDisplayName(ch))}</option>`;
    }).join('');
    refreshModelRpmOptions();
  }

  function refreshModelRpmOptions() {
    if (!currentReport) return;
    const channelId = $('modelChannelSelect').value;
    const channel = currentReport.normalized.channels[channelId];
    const rpms = channel ? uniqueSorted(Object.keys(channel.spectraByRpm).map(Number)) : [];
    $('modelRpmSelect').innerHTML = rpms.map(rpm => `<option value="${rpm}">${rpm} rpm</option>`).join('');
    renderSelectedModel();
  }

  function getSelectedSpectrum() {
    if (!currentReport) return null;
    const channelId = $('modelChannelSelect').value;
    const rpm = $('modelRpmSelect').value;
    const channel = currentReport.normalized.channels[channelId];
    if (!channel) return null;
    const spectrum = channel.spectraByRpm[rpm];
    return spectrum ? { channel, spectrum } : null;
  }

  function renderSelectedModel() {
    const selected = getSelectedSpectrum();
    if (!selected) {
      $('modelSummary').innerHTML = '';
      $('sampleBody').innerHTML = '';
      $('jsonPreview').textContent = '선택 가능한 정규화 데이터가 없습니다.';
      return;
    }
    const { channel, spectrum } = selected;
    const checks = [
      ['채널 ID', channel.channelId], ['Curve', spectrum.curveNo], ['RPM', spectrum.rpm],
      ['데이터 수', spectrum.sampleCount], ['주파수 범위', `${formatNumber(spectrum.minFrequency)} ~ ${formatNumber(spectrum.maxFrequency)} ${spectrum.xUnit}`],
      ['주파수 간격', `${formatNumber(spectrum.frequencyResolution)} ${spectrum.xUnit}`]
    ];
    $('modelSummary').innerHTML = checks.map(([label,value]) =>
      `<div class="summary-item"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(String(value))}</span></div>`
    ).join('');
    const count = Math.min(10, spectrum.sampleCount);
    $('sampleBody').innerHTML = Array.from({length: count}, (_, i) =>
      `<tr><td class="num">${i}</td><td class="num">${formatNumber(spectrum.frequency[i])}</td><td class="num">${formatNumber(spectrum.amplitude[i])}</td></tr>`
    ).join('');
    $('jsonPreview').textContent = JSON.stringify({
      channelId: channel.channelId,
      point: channel.point,
      direction: channel.direction,
      label: channel.label,
      spectrum: {
        ...spectrum,
        frequency: spectrum.frequency.slice(0, 10),
        amplitude: spectrum.amplitude.slice(0, 10),
        previewNote: `배열은 화면 표시를 위해 처음 10개만 표시. 실제 정규화 모델에는 ${spectrum.sampleCount}개 전체 데이터 포함.`
      }
    }, null, 2);
  }

  function downloadNormalizedModel() {
    if (!currentReport) return;
    const json = JSON.stringify(currentReport.normalized, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentReport.fileName.replace(/\.csv$/i, '') + '_normalized.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function copySelectedJson() {
    const selected = getSelectedSpectrum();
    if (!selected) return;
    const text = JSON.stringify({
      channelId: selected.channel.channelId,
      point: selected.channel.point,
      direction: selected.channel.direction,
      label: selected.channel.label,
      spectrum: selected.spectrum
    }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('선택 Curve의 전체 정규화 JSON을 클립보드에 복사했습니다.', 'success');
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text; document.body.appendChild(area); area.select();
      document.execCommand('copy'); area.remove();
      setStatus('선택 Curve의 전체 정규화 JSON을 클립보드에 복사했습니다.', 'success');
    }
  }

  const MULTI_COLORS = ['#1769aa','#d65b20','#16845b','#6b4bb8','#c43c78','#8c6b18','#008b95','#7b8794','#d13b32','#477db3','#7a4fa3','#4d8c57','#e38b2c','#2d6974','#9f4e55','#5668b3'];
  let multiAnalysisRows = [];
  let combinedChartSeries = [];
  let combinedChartSelection = null;
  let combinedPlotPoints = [];
  let combinedHoverPoint = null;
  let spectrumMapHover = null;
  let spectrumMapGeometry = null;
  let mapXAxisMode = 'frequency';

  function channelDisplayName(channel) { return channel.point + (channel.direction ? ' ' + channel.direction : '') + ' [' + (channel.channelType === 'noise' ? '소음' : '진동') + ']'; }
  function hasDbInputForType(report, channelType) {
    return report.curves.some(curve => curve.channelType === channelType && isDbScaleUnit(curve.inputScale || curve.yUnit));
  }
  function updateInputDbReferencePanels(report) {
    const noiseHasDbInput = hasDbInputForType(report, 'noise');
    const vibrationHasDbInput = hasDbInputForType(report, 'vibration');
    $('noiseInputDbReferencePanel').classList.toggle('hidden', !noiseHasDbInput);
    $('vibrationInputDbReferencePanel').classList.toggle('hidden', !vibrationHasDbInput);
    $('noiseSourceDbReference').disabled = !noiseHasDbInput;
    $('vibrationSourceDbReference').disabled = !vibrationHasDbInput;
  }
  function renderMultiWorkspace(report) {
    updateInputDbReferencePanels(report);
    updateLinearUnitLabels();
    const grid=$('multiChannelGrid');
    const groups = [
      { type:'noise', title:'소음 채널' },
      { type:'vibration', title:'진동 채널' }
    ];
    grid.innerHTML = groups.map(group => {
      const ids = report.normalized.channelOrder.filter(id => report.normalized.channels[id].channelType === group.type);
      if (!ids.length) return '';
      let items = '';
      if (group.type === 'noise') {
        items = ids.map((id, index) => {
          const ch = report.normalized.channels[id];
          const checked = index === 0 ? 'checked' : '';
          const pointName = String(ch.point || '').trim();
          const shortName = pointName || id;
          return `<label class="channel-option" title="${escapeHtml(channelDisplayName(ch))}"><input class="multi-channel" data-channel-type="noise" type="checkbox" value="${escapeHtml(id)}" ${checked}><span class="channel-name">${escapeHtml(shortName)}</span></label>`;
        }).join('');
      } else {
        const pointGroups = new Map();
        ids.forEach(id => {
          const ch = report.normalized.channels[id];
          const pointName = String(ch.point || '').trim() || id.replace(/_[XYZ]$/i, '');
          if (!pointGroups.has(pointName)) pointGroups.set(pointName, []);
          pointGroups.get(pointName).push({ id, channel: ch });
        });
        items = [...pointGroups.entries()].map(([pointName, entries]) => {
          const directions = ['X','Y','Z'].map(direction => {
            const entry = entries.find(item => String(item.channel.direction || '').toUpperCase() === direction);
            if (!entry) return '';
            return `<label class="direction-option" title="${escapeHtml(channelDisplayName(entry.channel))}"><input class="multi-channel" data-channel-type="vibration" type="checkbox" value="${escapeHtml(entry.id)}"><span>${direction}</span></label>`;
          }).join('');
          return `<div class="vibration-point-row"><span class="vibration-point-name">${escapeHtml(pointName)}</span><div class="direction-checks">${directions}</div></div>`;
        }).join('');
      }
      return `<section class="channel-group ${group.type}"><div class="channel-group-header"><div class="channel-group-title"><span>${group.title}</span><span class="channel-group-count">${ids.length}</span></div><div class="channel-group-actions"><button class="secondary group-select" data-channel-type="${group.type}" type="button">전체</button><button class="secondary group-clear" data-channel-type="${group.type}" type="button">해제</button></div></div><div class="channel-group-items">${items}</div></section>`;
    }).join('');
    document.querySelectorAll('.multi-channel').forEach(el=>el.addEventListener('change',renderMultiAnalysis));
    document.querySelectorAll('.group-select').forEach(button=>button.addEventListener('click',()=>{
      document.querySelectorAll(`.multi-channel[data-channel-type="${button.dataset.channelType}"]`).forEach(input=>input.checked=true);
      renderMultiAnalysis();
    }));
    document.querySelectorAll('.group-clear').forEach(button=>button.addEventListener('click',()=>{
      document.querySelectorAll(`.multi-channel[data-channel-type="${button.dataset.channelType}"]`).forEach(input=>input.checked=false);
      renderMultiAnalysis();
    }));
    if (!document.querySelector('.multi-channel:checked')) {
      const firstChannel = document.querySelector('.multi-channel');
      if (firstChannel) firstChannel.checked = true;
    }
    initializeMapChannelOptions(report);
    initializeResizeObservers();
    renderMultiAnalysis();
  }

  function parseOrders(text) {
    return [...new Set(String(text).split(/[,;\s]+/).map(Number).filter(v=>Number.isFinite(v)&&v>=0))].sort((a,b)=>a-b);
  }

  let resizeObserversInitialized=false;
  function initializeResizeObservers() {
    if (resizeObserversInitialized || typeof ResizeObserver==='undefined') return;
    resizeObserversInitialized=true;
    const redrawOrder=debounce(renderMultiAnalysis,80);
    const redrawMap=debounce(renderMultiColorMap,80);
    new ResizeObserver(redrawOrder).observe($('orderGraphFrame'));
    new ResizeObserver(redrawMap).observe($('spectrumMapFrame'));
  }

  function initializeGraphAxisInputs(series, sel) {
    const all=series.flatMap(item=>item.rows.filter(r=>Number.isFinite(r.displayAmplitude)));
    if (!all.length) return;
    const rpmMin=safeMin(all.map(r=>r.rpm));
    const rpmMax=safeMax(all.map(r=>r.rpm));
    let ampMin=safeMin(all.map(r=>r.displayAmplitude));
    let ampMax=safeMax(all.map(r=>r.displayAmplitude));
    if (all.some(r=>r.displayMode==='linear')) ampMin=Math.min(0,ampMin);
    const pad=(ampMax-ampMin||Math.abs(ampMax)||1)*0.12;
    const signature=sel.channelIds.join('|')+'::'+sel.orders.join('|')+'::'+sel.searchWidth+'::'+sel.sumWidth+'::'+JSON.stringify(sel.settings);
    const holder=$('combinedOrderCanvas');
    if (holder.dataset.axisSignature!==signature) {
      $('graphRpmMin').value=formatInteger(rpmMin);
      $('graphRpmMax').value=formatInteger(rpmMax);
      $('graphAmpMin').value=formatSig4(all.every(r=>r.displayMode==='linear')?ampMin:ampMin-pad);
      $('graphAmpMax').value=formatSig4(ampMax+pad);
      holder.dataset.axisSignature=signature;
    }
  }

  function initializeMapAxisInputs() {
    if (!currentReport) return;
    const channel=currentReport.normalized.channels[$('mapChannelSelect').value];
    if (!channel) return;
    const rpms=uniqueSorted(Object.keys(channel.spectraByRpm).map(Number));
    if (rpms.length) {
      $('mapRpmMin').value=formatInteger(safeMin(rpms));
      $('mapRpmMax').value=formatInteger(safeMax(rpms));
    }
    updateMapColorAxisInputs();
  }

  function updateMapColorAxisInputs() {
    if (!currentReport) return;
    const channel=currentReport.normalized.channels[$('mapChannelSelect').value];
    if (!channel) return;
    const fMin=Number($('mapMinFrequency').value),fMax=Number($('mapMaxFrequency').value);
    const mapSettings=getChannelTypeSettings(channel);
    const mode=mapSettings.mode,reference=Number(mapSettings.orderDbReference);
    const sourceRef=mapSettings.sourceDbReference;
    const values=[];
    for (const spectrum of Object.values(channel.spectraByRpm)) {
      for (let i=0;i<spectrum.frequency.length;i++) {
        const f=spectrum.frequency[i];
        if (f>=fMin&&f<=fMax) {
          const v=convertAmplitude(spectrum.amplitude[i],f,mode,reference,spectrum.yUnit,sourceRef);
          if (Number.isFinite(v)) values.push(v);
        }
      }
    }
    if (values.length) {
      $('mapAmpMin').value=formatSig4(safeMin(values));
      $('mapAmpMax').value=formatSig4(safeMax(values));
    }
  }

  function formatInputNumber(value) {
    if (!Number.isFinite(value)) return '';
    return Number(value.toPrecision(8)).toString();
  }

  function getMultiSelection() {
    if(!currentReport)return null;
    const channelIds=[...document.querySelectorAll('.multi-channel:checked')].map(x=>x.value);
    const orders=parseOrders($('multiOrderInput').value);
    const searchWidth=Number($('multiSearchWidth').value);
    const sumWidth=Number($('multiSumWidth').value);
    const settings={
      noise:{ mode:$('noiseAmplitudeMode').value, sourceDbReference:Number($('noiseSourceDbReference').value), orderDbReference:Number($('noiseOrderDbReference').value) },
      vibration:{ mode:$('vibrationAmplitudeMode').value, sourceDbReference:Number($('vibrationSourceDbReference').value), orderDbReference:Number($('vibrationOrderDbReference').value) }
    };
    const noiseNeedsInputDbReference = hasDbInputForType(currentReport, 'noise');
    const vibrationNeedsInputDbReference = hasDbInputForType(currentReport, 'vibration');
    const validSettings = ['noise','vibration'].every(type => {
      const x=settings[type];
      const needsSourceReference = type === 'noise' ? noiseNeedsInputDbReference : vibrationNeedsInputDbReference;
      return ['linear','db','dba'].includes(x.mode)
        && (!needsSourceReference || (Number.isFinite(x.sourceDbReference) && x.sourceDbReference > 0))
        && Number.isFinite(x.orderDbReference) && x.orderDbReference > 0;
    });
    if(!channelIds.length||!orders.length||!Number.isFinite(searchWidth)||searchWidth<0||!Number.isFinite(sumWidth)||sumWidth<0||!validSettings)return null;
    return {channelIds,orders,searchWidth,sumWidth,settings};
  }

  function buildRssSumSeries(channel, channelId, orders, sel, color) {
    if (!channel || orders.length < 2) return null;
    const type = channel.channelType === 'noise' ? 'noise' : 'vibration';
    const settings = sel.settings[type];
    // 각 오더는 calculateOrderRows()에서 이미
    // "이론 주파수 → Peak Search Range → 실제 피크 → 피크 중심 ± Sum Width"를 적용합니다.
    // 따라서 여기서는 각 오더의 최종 orderAmplitude를 동일 RPM 기준으로 RSS 합산합니다.
    const orderRows = orders.map(order => ({
      order,
      rows: calculateOrderRows(channel, order, sel.searchWidth, sel.sumWidth, sel.searchWidth)
    }));
    const rpmSet = uniqueSorted(orderRows.flatMap(item => item.rows.map(r => r.rpm)));
    const rows = rpmSet.map(rpm => {
      const components = orderRows.map(item => ({
        order: item.order,
        row: item.rows.find(r => r.rpm === rpm)
      }));
      if (components.some(x => !x.row || !Number.isFinite(x.row.orderAmplitude))) return null;

      // orderAmplitude가 선형값이면 그대로 사용하고, 원본이 dB/dBA이면
      // 각 오더의 합산 level을 원본 기준 진폭으로 역변환한 뒤 RSS 합니다.
      const linearComponents = components.map(x => ({
        ...x,
        linearAmplitude: orderAmplitudeToLinear(x.row.orderAmplitude, x.row.sourceUnit, x.row.physicalUnit, getChannelTypeSettings(channel).sourceDbReference)
      }));
      if (linearComponents.some(x => !Number.isFinite(x.linearAmplitude) || x.linearAmplitude < 0)) return null;

      const rssInternal = Math.sqrt(linearComponents.reduce((sum, x) => sum + x.linearAmplitude * x.linearAmplitude, 0));
      if (!Number.isFinite(rssInternal)) return null;

      // dBA는 각 오더의 실제 피크 주파수에서 A-weighting 후 에너지 합산합니다.
      // 원본이 이미 dBA인 경우에는 중복 weighting하지 않습니다.
      let displayAmplitude;
      if (settings.mode === 'dba') {
        const sourceAlreadyDba = linearComponents.every(x => String(x.row.sourceUnit || '').toLowerCase() === 'dba');
        const weightedRss = sourceAlreadyDba
          ? rssInternal
          : Math.sqrt(linearComponents.reduce((sum, x) => {
              const w = Math.pow(10, aWeighting(x.row.peakFrequency) / 20);
              return sum + Math.pow(x.linearAmplitude * w, 2);
            }, 0));
        displayAmplitude = weightedRss > 0 ? 20 * Math.log10(weightedRss / settings.orderDbReference) : NaN;
      } else if (settings.mode === 'db') {
        displayAmplitude = rssInternal > 0 ? 20 * Math.log10(rssInternal / settings.orderDbReference) : NaN;
      } else {
        displayAmplitude = rssInternal;
      }

      const representative = components[0].row;
      return {
        rpm,
        orderAmplitude: rssInternal,
        displayAmplitude,
        displayMode: settings.mode,
        displayUnit: amplitudeUnit(settings.mode),
        sourceOrders: orders.slice(),
        componentRows: components,
        matched: components.every(x => x.row.matched),
        point: channel.point,
        direction: channel.direction,
        channelId,
        channelType: type,
        // 그래프/XLSX에서 피크 중심 합산 범위를 명확히 확인할 수 있도록 보존
        componentPeakSummary: components.map(x => ({
          order: x.order,
          peakFrequency: x.row.peakFrequency,
          sumMin: x.row.sumMin,
          sumMax: x.row.sumMax,
          summedPointCount: x.row.summedPointCount
        }))
      };
    }).filter(Boolean);
    return {channelId, channel, order:null, orders:orders.slice(), rows, color, settings, isRssSum:true};
  }

  function orderAmplitudeToLinear(value, sourceUnit, physicalUnit, sourceDbReference) {
    if (!Number.isFinite(value)) return NaN;
    if (isDbScaleUnit(sourceUnit)) {
      const ref = Number(sourceDbReference);
      return ref > 0 ? ref * Math.pow(10, value / 20) : NaN;
    }
    return Math.abs(value);
  }

  function fitCompactKpiText() {
    document.querySelectorAll('#multiKpis .compact-kpi strong').forEach(el => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(size)) return;
      const minSize = 9;
      // 텍스트가 박스 폭을 넘으면 실제 렌더링 폭을 기준으로 단계적으로 축소합니다.
      while (el.scrollWidth > el.clientWidth + 1 && size > minSize) {
        size -= 0.5;
        el.style.fontSize = size.toFixed(1) + 'px';
      }
    });
  }

  function renderMultiAnalysis() {
    if(!currentReport)return;
    const sel=getMultiSelection();
    const orderOutputElements=[$('multiKpis'),$('combinedLegend'),$('orderGraphFrame'),$('combinedChartControls'),$('orderGraphNote'),$('orderContributionSection')].filter(Boolean);
    if(!sel){
      multiAnalysisRows=[];
      orderOutputElements.forEach(el=>el.classList.add('analysis-output-hidden'));
      $('multiKpis').innerHTML='';
      $('combinedLegend').innerHTML='';
      renderContributionAnalysis();
      return;
    }
    syncSpectrumMapChannelOptions(sel.channelIds);
    orderOutputElements.forEach(el=>el.classList.remove('analysis-output-hidden'));
    const series=[]; multiAnalysisRows=[];
    let colorIndex=0;
    for(const channelId of sel.channelIds){
      const channel=currentReport.normalized.channels[channelId];
      const channelSettings=sel.settings[channel.channelType === 'noise' ? 'noise' : 'vibration'];
      for(const order of sel.orders){
        const rows=calculateOrderRows(channel,order,sel.searchWidth,sel.sumWidth,sel.searchWidth).map(r => ({...r, displayMode:channelSettings.mode, displayUnit:amplitudeUnit(channelSettings.mode), displayAmplitude:convertAmplitude(r.orderAmplitude,r.peakFrequency,channelSettings.mode,channelSettings.orderDbReference,r.sourceUnit,channelSettings.sourceDbReference)}));
        const item={channelId,channel,order,rows,color:MULTI_COLORS[colorIndex%MULTI_COLORS.length],settings:channelSettings};
        series.push(item); colorIndex++;
        rows.forEach(r=>multiAnalysisRows.push({...r,channelId,point:channel.point,direction:channel.direction}));
      }
      if(sel.orders.length >= 2){
        const rssItem=buildRssSumSeries(channel,channelId,sel.orders,sel,MULTI_COLORS[colorIndex%MULTI_COLORS.length]);
        if(rssItem){
          series.push(rssItem);
          colorIndex++;
        }
      }
    }
    const showOverall = $('showOverall')?.checked !== false;
    const showRssSum = $('showRssSum')?.checked !== false;
    for(const channelId of sel.channelIds){
      const channel=currentReport.normalized.channels[channelId];
      const settings=sel.settings[channel.channelType === 'noise' ? 'noise' : 'vibration'];
      if(showOverall){
        const overallItem=buildOverallSeries(channel,channelId,settings,MULTI_COLORS[colorIndex%MULTI_COLORS.length]);
        if(overallItem){series.push(overallItem);colorIndex++;}
      }
    }
    const visibleSeries = series.filter(x => (!x.isRssSum || showRssSum) && (!x.isOverall || showOverall));
    const matched=multiAnalysisRows.filter(r=>r.matched).length;
    const maxRow=multiAnalysisRows.filter(r=>Number.isFinite(r.displayAmplitude)).reduce((best,r)=>!best||r.displayAmplitude>best.displayAmplitude?r:best,null);
    const kpis=[['선택 채널',sel.channelIds.length+'개'],['선택 오더',sel.orders.join(', ')],['그래프 계열',visibleSeries.length+'개'],['Overall 그래프',showOverall?'표시':'숨김'],['RSS 그래프',sel.orders.length>=2?(showRssSum?'표시':'숨김'):'오더 2개 이상 필요'],['최대 Order 진폭',maxRow?formatSig4(maxRow.displayAmplitude)+' '+maxRow.displayUnit:'-']];
    $('multiKpis').innerHTML=kpis.map(([l,v])=>`<div class="compact-kpi ${l==='최대 조건'?'max-condition':''}" title="${escapeHtml(String(v))}"><span>${escapeHtml(l)}</span><strong>${escapeHtml(String(v))}</strong></div>`).join('');
    fitCompactKpiText();

    initializeGraphAxisInputs(visibleSeries, sel);
    drawCombinedOrderChart(visibleSeries,sel);
    renderContributionAnalysis();
    renderMultiColorMap();
    const legendGroups={};
    visibleSeries.forEach(x=>{(legendGroups[x.channelId] ||= []).push(x);});
    $('combinedLegend').innerHTML=Object.entries(legendGroups).map(([channelId,items])=>`<div class="series-legend-group"><div class="series-legend-group-title">${escapeHtml(channelId)}</div><div class="series-legend-items">${items.map(x=>x.isRssSum ? `<span class="series-key rss-series-key" style="color:${x.color}"><span class="series-color" style="color:${x.color}"></span>RSS (${escapeHtml(x.orders.join(' + '))})</span>` : x.isOverall ? `<span class="series-key overall-series-key" style="color:${x.color}"><span class="series-color" style="color:${x.color}"></span>Overall</span>` : `<span class="series-key" style="color:${x.color}"><span class="series-color" style="background:${x.color}"></span>${formatNumber(x.order)}차</span>`).join('')}</div></div>`).join('');
  }

  // [v40 feature] RPM별 전체 Spectrum Overall 계산
  function calculateOverallRows(channel, settings) {
    if (!channel) return [];
    const rpms = uniqueSorted(Object.keys(channel.spectraByRpm).map(Number));
    return rpms.map(rpm => {
      const spectrum = channel.spectraByRpm[String(rpm)];
      if (!spectrum || !Array.isArray(spectrum.frequency) || !Array.isArray(spectrum.amplitude)) return null;
      let baseEnergy = 0;
      let weightedEnergy = 0;
      let validCount = 0;
      const sourceUnit = spectrum.yUnit;
      const sourceRef = Number(settings.sourceDbReference);
      const alreadyDba = isDbaUnit(sourceUnit);
      for (let i = 0; i < spectrum.frequency.length; i++) {
        const f = spectrum.frequency[i], raw = spectrum.amplitude[i];
        if (!Number.isFinite(f) || !Number.isFinite(raw)) continue;
        let linear = NaN;
        if (isDbScaleUnit(sourceUnit)) {
          if (!(sourceRef > 0)) continue;
          const db = isDbaUnit(sourceUnit) ? raw - aWeighting(f) : raw;
          linear = sourceRef * Math.pow(10, db / 20);
        } else {
          linear = Math.abs(raw);
        }
        if (!Number.isFinite(linear) || linear < 0) continue;
        baseEnergy += linear * linear;
        const weighted = alreadyDba ? linear : linear * Math.pow(10, aWeighting(f) / 20);
        if (Number.isFinite(weighted)) weightedEnergy += weighted * weighted;
        validCount++;
      }
      if (!(baseEnergy > 0) || !Number.isFinite(baseEnergy) || validCount === 0) return null;
      const baseOverall = Math.sqrt(baseEnergy);
      const weightedOverall = Math.sqrt(weightedEnergy);
      let displayAmplitude;
      if (settings.mode === 'dba') {
        displayAmplitude = weightedOverall > 0 ? 20 * Math.log10(weightedOverall / settings.orderDbReference) : NaN;
      } else if (settings.mode === 'db') {
        displayAmplitude = baseOverall > 0 ? 20 * Math.log10(baseOverall / settings.orderDbReference) : NaN;
      } else {
        displayAmplitude = baseOverall;
      }
      return { rpm, linearAmplitude:baseOverall, weightedLinearAmplitude:weightedOverall, displayAmplitude, displayUnit:amplitudeUnit(settings.mode), point:channel.point, direction:channel.direction, channelId:channel.channelId, validCount };
    }).filter(Boolean);
  }

  // [v40 feature] Order Analysis 하위 차수별 기여도 계산
  function getContributionRows(channel, orders, sel) {
    if (!channel || !Array.isArray(orders) || orders.length < 2) return [];
    const type = channel.channelType === 'noise' ? 'noise' : 'vibration';
    const settings = sel.settings[type];
    const orderRows = orders.map(order => ({
      order,
      rows: calculateOrderRows(channel, order, sel.searchWidth, sel.sumWidth, sel.searchWidth)
    }));
    const overallRows = calculateOverallRows(channel, settings);
    const rpmSet = uniqueSorted(overallRows.map(r => r.rpm));
    return rpmSet.map(rpm => {
      const overall = overallRows.find(r => r.rpm === rpm);
      const components = orderRows.map(item => ({ order:item.order, row:item.rows.find(r => r.rpm === rpm) }));
      if (!overall || components.some(x => !x.row || !Number.isFinite(x.row.orderAmplitude))) return null;
      const linear = components.map(x => {
        const base = orderAmplitudeToLinear(x.row.orderAmplitude, x.row.sourceUnit, x.row.physicalUnit, settings.sourceDbReference);
        let weighted = base;
        if (settings.mode === 'dba' && !isDbaUnit(x.row.sourceUnit)) weighted = base * Math.pow(10, aWeighting(x.row.peakFrequency) / 20);
        return { ...x, linearAmplitude:base, contributionAmplitude:weighted };
      });
      if (linear.some(x => !Number.isFinite(x.contributionAmplitude) || x.contributionAmplitude < 0)) return null;
      const denominator = settings.mode === 'dba' ? overall.weightedLinearAmplitude ** 2 : overall.linearAmplitude ** 2;
      if (!(denominator > 0) || !Number.isFinite(denominator)) return null;
      const contributions = linear.map(x => ({ order:x.order, amplitude:x.contributionAmplitude, percent:(x.contributionAmplitude*x.contributionAmplitude/denominator)*100, row:x.row }));
      const dominant = contributions.reduce((a,b)=>b.percent>a.percent?b:a, contributions[0]);
      return { rpm, overall, contributions, rss:Math.sqrt(linear.reduce((sum,x)=>sum+x.contributionAmplitude*x.contributionAmplitude,0)), dominantOrder:dominant.order, dominantPercent:dominant.percent, matched:components.every(x=>x.row.matched) };
    }).filter(Boolean);
  }

  function buildOverallSeries(channel, channelId, settings, color) {
    const rows=calculateOverallRows(channel,settings);
    if(!rows.length) return null;
    return {channelId, channel, order:null, orders:[], rows:rows.map(r=>({...r, displayMode:settings.mode})), color, settings, isOverall:true};
  }

  function initializeContributionChannelOptions(sel) {
    const select=$('contributionChannelSelect');
    if (!select || !currentReport || !sel) return;
    const previous=select.value;
    const valid=sel.channelIds.filter(id=>currentReport.normalized.channels[id]);
    select.innerHTML=valid.map(id=>{
      const ch=currentReport.normalized.channels[id];
      return `<option value="${escapeHtml(id)}">${escapeHtml(channelDisplayName(ch))}</option>`;
    }).join('');
    if (valid.includes(previous)) select.value=previous;
    else if (valid.length) select.value=valid[0];
  }

  function drawContributionChart(rows, orders) {
    const canvas=$('orderContributionCanvas'), wrap=$('contributionChartWrap');
    if (!canvas || !wrap) return;
    const width=Math.max(520,wrap.clientWidth), height=Math.max(300,wrap.clientHeight), dpr=Math.max(1,window.devicePixelRatio||1);
    canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr); canvas.style.width=width+'px'; canvas.style.height=height+'px';
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    ctx.fillStyle=isDarkMode()?'#111820':'#fff'; ctx.fillRect(0,0,width,height);
    if (!rows.length) { ctx.fillStyle=isDarkMode()?'#dbe4ec':'#4b5563'; ctx.font='14px Malgun Gothic, sans-serif'; ctx.textAlign='center'; ctx.fillText('표시할 기여도 데이터가 없습니다.',width/2,height/2); return; }
    const margin={left:70,right:25,top:25,bottom:55}, plotW=width-margin.left-margin.right, plotH=height-margin.top-margin.bottom;
    const maxBars=Math.min(80,rows.length), sampled=rows.length<=maxBars?rows:rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/maxBars)===0);
    const step=plotW/Math.max(1,sampled.length), barW=Math.max(3,step*0.72);
    const colors=orders.map((_,i)=>MULTI_COLORS[i%MULTI_COLORS.length]);
    ctx.strokeStyle=isDarkMode()?'#4b5563':'#cfd6de'; ctx.lineWidth=1;
    [0,25,50,75,100].forEach(v=>{const y=margin.top+plotH-(v/100)*plotH;ctx.beginPath();ctx.moveTo(margin.left,y);ctx.lineTo(width-margin.right,y);ctx.stroke();ctx.fillStyle=isDarkMode()?'#cbd5df':'#667085';ctx.font='10px Malgun Gothic, sans-serif';ctx.textAlign='right';ctx.fillText(v+'%',margin.left-8,y+3);});
    sampled.forEach((r,i)=>{
      const x=margin.left+i*step+(step-barW)/2; let top=margin.top+plotH;
      r.contributions.forEach((c,oi)=>{const h=(c.percent/100)*plotH; top-=h;ctx.fillStyle=colors[oi];ctx.fillRect(x,top,barW,h);});
      if (i===0||i===sampled.length-1||sampled.length<=12) {ctx.fillStyle=isDarkMode()?'#dbe4ec':'#475467';ctx.font='10px Malgun Gothic, sans-serif';ctx.textAlign='center';ctx.fillText(String(r.rpm),x+barW/2,height-margin.bottom+19);}
    });
    ctx.fillStyle=isDarkMode()?'#dbe4ec':'#344054';ctx.font='11px Malgun Gothic, sans-serif';ctx.textAlign='center';ctx.fillText('RPM',margin.left+plotW/2,height-10);
    ctx.save();ctx.translate(15,margin.top+plotH/2);ctx.rotate(-Math.PI/2);ctx.fillText('차수별 기여도 (%)',0,0);ctx.restore();
  }

  function renderContributionAnalysis() {
    const section=$('orderContributionSection');
    if (!section || !currentReport) return;
    const sel=getMultiSelection();
    if (!sel || sel.orders.length<2) {
      section.classList.add('analysis-output-hidden');
      return;
    }
    section.classList.remove('analysis-output-hidden');
    initializeContributionChannelOptions(sel);
    const channel=currentReport.normalized.channels[$('contributionChannelSelect').value];
    const rows=getContributionRows(channel,sel.orders,sel);
    const orders=sel.orders;
    const summary=$('contributionSummary');
    if (!rows.length) {
      summary.innerHTML='<div class="contribution-kpi"><span class="label">상태</span><span class="value">유효 데이터 없음</span></div>';
      $('contributionLegend').innerHTML=''; $('contributionTableHead').innerHTML=''; $('contributionTableBody').innerHTML=''; $('contributionNote').textContent='선택한 채널/Order 조합에서 모든 구성 차수의 유효한 합산 진폭을 확보할 수 없습니다.';
      drawContributionChart([],orders); return;
    }
    const avg=orders.map(order=>({order,percent:rows.reduce((s,r)=>s+(r.contributions.find(c=>c.order===order)?.percent||0),0)/rows.length}));
    const dominantCounts=orders.map(order=>({order,count:rows.filter(r=>r.dominantOrder===order).length}));
    const avgTop=avg.reduce((a,b)=>b.percent>a.percent?b:a,avg[0]);
    const domTop=dominantCounts.reduce((a,b)=>b.count>a.count?b:a,dominantCounts[0]);
    const maxRow=rows.reduce((a,b)=>b.dominantPercent>a.dominantPercent?b:a,rows[0]);
    const matched=rows.filter(r=>r.matched).length;
    summary.innerHTML=[
      ['Overall 최대',`${formatGraphSig4(maxRow.overall.displayAmplitude)} ${maxRow.overall.displayUnit}`],
      ['평균 최대 기여 차수',`${formatNumber(avgTop.order)}차 · ${formatGraphSig4(avgTop.percent)}%`],
      ['최대 기여도',`${formatGraphSig4(maxRow.dominantPercent)}%`],
      ['최대 기여 발생',`${formatInteger(maxRow.rpm)} rpm · ${formatNumber(maxRow.dominantOrder)}차`],
      ['Overall 유효 RPM',`${matched} / ${rows.length}`]
    ].map(([l,v])=>`<div class="contribution-kpi"><span class="label">${escapeHtml(l)}</span><span class="value" title="${escapeHtml(String(v))}">${escapeHtml(String(v))}</span></div>`).join('');
    $('contributionLegend').innerHTML=orders.map((o,i)=>`<span class="contribution-legend-item"><span class="contribution-legend-swatch" style="background:${MULTI_COLORS[i%MULTI_COLORS.length]}"></span>${formatNumber(o)}차</span>`).join('');
    $('contributionTableHead').innerHTML='<tr><th>RPM</th>'+orders.map(o=>`<th>${formatNumber(o)}차 기여도</th>`).join('')+'<th>주도 차수</th><th>주도 기여도</th></tr>';
    $('contributionTableBody').innerHTML=rows.map(r=>`<tr><td>${formatInteger(r.rpm)}</td>${orders.map(o=>{const c=r.contributions.find(x=>x.order===o);return `<td>${c?formatGraphSig4(c.percent)+'%':'-'}</td>`}).join('')}<td class="dominant">${formatNumber(r.dominantOrder)}차</td><td class="dominant">${formatGraphSig4(r.dominantPercent)}%</td></tr>`).join('');
    $('contributionNote').textContent=`기여도는 각 차수의 에너지 성분(A²)을 해당 RPM의 전체 Spectrum Overall 에너지(ΣA²)로 나눈 값.
따라서 선택한 차수 외의 Spectrum 성분이 존재하면 선택 차수 기여도 합계가 100%보다 작을 수 있음.
dBA 모드에서는 각 차수의 실제 피크 주파수에 A-weighting을 적용한 진폭을 사용.`;
    drawContributionChart(rows,orders);
  }

  // [v40 feature] 기존 Order Analysis XLSX에 Order Contribution 시트로 추가
  function buildContributionXlsxRows() {
    const output=[['채널','위치','방향','RPM','Overall 진폭','표시단위','차수','차수 진폭','기여도(%)','주도 차수','주도 기여도(%)','구성 차수 유효성']];
    if(!currentReport) return output;
    const sel=getMultiSelection(); if(!sel || sel.orders.length<2) return output;
    for(const channelId of sel.channelIds){
      const channel=currentReport.normalized.channels[channelId];
      if(!channel) continue;
      const rows=getContributionRows(channel,sel.orders,sel);
      const settings=sel.settings[channel.channelType === 'noise' ? 'noise' : 'vibration'];
      for(const r of rows){
        for(const c of r.contributions){
          const displayOrder=convertAmplitude(c.row.orderAmplitude,c.row.peakFrequency,settings.mode,settings.orderDbReference,c.row.sourceUnit,settings.sourceDbReference);
          output.push([channelId,channel.point,channel.direction,r.rpm,r.overall.displayAmplitude,r.overall.displayUnit,c.order,displayOrder,c.percent,r.dominantOrder,r.dominantPercent,r.matched?'모두 일치':'일부 불일치']);
        }
      }
    }
    return output;
  }

  function drawCombinedOrderChart(series,sel){
    combinedChartSeries=series;combinedChartSelection=sel;combinedPlotPoints=[];
    const canvas=$('combinedOrderCanvas'), frame=$('orderGraphFrame'), width=Math.max(500,frame.clientWidth),height=Math.max(300,frame.clientHeight),dpr=Math.max(1,window.devicePixelRatio||1);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=isDarkMode()?'#151e27':'#fff';ctx.fillRect(0,0,width,height);
    const all=series.flatMap(s=>s.rows.filter(r=>Number.isFinite(r.displayAmplitude)));
    if(!all.length){drawEmptyCombined('표시할 시험 피크 진폭 데이터가 없습니다.',ctx,width,height);return;}
    const margin={left:82,right:28,top:26,bottom:58},plotW=width-margin.left-margin.right,plotH=height-margin.top-margin.bottom;
    const rpms=uniqueSorted(all.map(r=>r.rpm));
    const dataXMin=safeMin(rpms),dataXMax=safeMax(rpms);
    let xMin=optionalNumber($('graphRpmMin').value,dataXMin),xMax=optionalNumber($('graphRpmMax').value,dataXMax);
    if(!(xMax>xMin)){xMin=dataXMin;xMax=dataXMax;}
    let dataYMin=safeMin(all.map(r=>r.displayAmplitude)),dataYMax=safeMax(all.map(r=>r.displayAmplitude)); if(all.some(r=>r.displayMode==='linear')) dataYMin=Math.min(0,dataYMin); const pad=(dataYMax-dataYMin||1)*.12;
    let yMin=optionalNumber($('graphAmpMin').value,dataYMin-(all.every(r=>r.displayMode==='linear')?0:pad)),yMax=optionalNumber($('graphAmpMax').value,dataYMax+pad);
    if(!(yMax>yMin)){yMin=dataYMin-(all.every(r=>r.displayMode==='linear')?0:pad);yMax=dataYMax+pad;}
    const x=v=>margin.left+(xMax===xMin?.5:(v-xMin)/(xMax-xMin))*plotW;
    const y=v=>margin.top+plotH-(v-yMin)/(yMax-yMin)*plotH;
    const units=[...new Set(series.flatMap(item=>item.rows.map(r=>r.displayUnit).filter(Boolean)))];
    const yUnitLabel=units.length===1 ? units[0] : 'mixed unit';
    drawAxesRange(ctx,margin,plotW,plotH,xMin,xMax,yMin,yMax,'RPM',`Order amplitude (${yUnitLabel})`,formatSig4,rpms.filter(rpm=>rpm>=xMin&&rpm<=xMax));
    series.forEach(item=>{
      const valid=item.rows.filter(r=>Number.isFinite(r.displayAmplitude)&&r.rpm>=xMin&&r.rpm<=xMax);
      ctx.strokeStyle=item.color;ctx.lineWidth=item.isOverall?3.8:(item.isRssSum?3.2:2.4);ctx.setLineDash(item.isOverall?[2,5]:(item.isRssSum?[9,4]:[]));ctx.beginPath();valid.forEach((r,i)=>i?ctx.lineTo(x(r.rpm),y(r.displayAmplitude)):ctx.moveTo(x(r.rpm),y(r.displayAmplitude)));ctx.stroke();ctx.setLineDash([]);
      valid.forEach(r=>{const canvasX=x(r.rpm),canvasY=y(r.displayAmplitude);combinedPlotPoints.push({canvasX,canvasY,row:r,channelId:item.channelId,order:item.order,isRssSum:!!item.isRssSum,isOverall:!!item.isOverall,orders:item.orders||[]});ctx.beginPath();ctx.arc(canvasX,canvasY,item.isOverall?5.5:(item.isRssSum?6:5),0,Math.PI*2);ctx.fillStyle=r.matched?item.color:'#fff';ctx.fill();ctx.strokeStyle=r.matched?item.color:'#ba2d2d';ctx.lineWidth=r.matched?2:3;ctx.stroke();});
    });
    if(combinedHoverPoint){const n=combinedPlotPoints.reduce((b,p)=>{const d=Math.hypot(p.canvasX-combinedHoverPoint.canvasX,p.canvasY-combinedHoverPoint.canvasY);return !b||d<b.d?{p,d}:b;},null);if(n&&n.d<1){const p=n.p,r=p.row;ctx.save();ctx.beginPath();ctx.arc(p.canvasX,p.canvasY,8,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.92)';ctx.fill();ctx.strokeStyle='#111827';ctx.lineWidth=2;ctx.stroke();const unit=r.displayUnit,lines=p.isOverall ? [p.channelId+' · Overall','X: '+formatInteger(r.rpm)+' RPM','Overall: '+formatGraphSig4(r.displayAmplitude)+' '+unit,'전체 Spectrum 유효 Bin: '+formatInteger(r.validCount)+'개'] : p.isRssSum ? [p.channelId+' · RSS ('+p.orders.map(formatGraphSig4).join(' + ')+')','X: '+formatInteger(r.rpm)+' RPM','RSS 합산값: '+formatGraphSig4(r.displayAmplitude)+' '+unit,'내부 RSS값: '+formatGraphSig4(r.orderAmplitude),'합산 오더: '+p.orders.map(formatGraphSig4).join(', ')+'차','구성 오더 모두 유효: '+(r.matched?'예':'아니오')] : [p.channelId+' · '+formatGraphSig4(p.order)+'차','X: '+formatInteger(r.rpm)+' RPM','Order 진폭: '+formatGraphSig4(r.displayAmplitude)+' '+unit,'원본 RSS값: '+formatGraphSig4(r.orderAmplitude),'RSS 범위: '+formatGraphSig4(r.sumMin)+' ~ '+formatGraphSig4(r.sumMax)+' Hz','RSS 포인트: '+formatInteger(r.summedPointCount)+'개','검출 피크: '+formatGraphSig4(r.peakFrequency)+' Hz / '+formatGraphSig4(r.peakAmplitude),'이론 주파수: '+formatGraphSig4(r.targetFrequency)+' Hz','주파수 편차: '+formatSignedGraph4(r.frequencyDeviation)+' Hz'];ctx.font='12px Malgun Gothic, sans-serif';const bw=Math.max(...lines.map(t=>ctx.measureText(t).width))+20,bh=lines.length*18+16;let bx=p.canvasX+12,by=p.canvasY-bh-12;if(bx+bw>width-6)bx=p.canvasX-bw-12;if(by<6)by=p.canvasY+12;if(by+bh>height-6)by=Math.max(6,height-bh-6);ctx.fillStyle=graphThemeColors().tooltipBg;ctx.strokeStyle=isDarkMode()?'#dbe4ec':'#fff';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(bx,by,bw,bh,6);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='top';lines.forEach((t,i)=>ctx.fillText(t,bx+10,by+8+i*18));ctx.restore();}}
  }

  function drawEmptyCombined(text,ctx,width,height){
    const canvas=$('combinedOrderCanvas');
    if(!ctx){const frame=$('orderGraphFrame'),w=Math.max(500,frame.clientWidth),h=Math.max(300,frame.clientHeight),dpr=Math.max(1,devicePixelRatio||1);canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);width=w;height=h;}
    ctx.fillStyle=isDarkMode()?'#151e27':'#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle=isDarkMode()?'#b8c4d0':'#7b8794';ctx.font='15px Malgun Gothic, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height/2);
  }


  function formatSig4(value) {
    if (!Number.isFinite(value)) return '-';
    if (value === 0) return '0';
    const abs=Math.abs(value);
    if (abs < 1) return value.toExponential(3);
    const exp=Math.floor(Math.log10(abs));
    if (exp >= 4) return value.toExponential(3);
    return value.toFixed(Math.max(0,3-exp));
  }
  function formatGraphSig4(value) {
    return formatSig4(Number(value));
  }
  function formatSignedGraph4(value) {
    if (!Number.isFinite(Number(value))) return '-';
    const number=Number(value);
    if (number === 0) return '0';
    const sign=number < 0 ? '-' : '+';
    return sign + formatSig4(Math.abs(number));
  }
  function formatInteger(value) {
    return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '-';
  }
  function detectedAmplitudeUnit() {
    return currentReport?.normalized?.axes?.yUnit || currentReport?.yUnit || '-';
  }
  function normalizeAmplitudeUnit(unit) { return String(unit || '').trim().toLowerCase().replace(/\s+/g,''); }
  function isDbScaleUnit(unit) { return ['db','dba','db(a)'].includes(normalizeAmplitudeUnit(unit)); }
  function isDbaUnit(unit) { return ['dba','db(a)'].includes(normalizeAmplitudeUnit(unit)); }
  function sourceIsDbScale() { return isDbScaleUnit(detectedAmplitudeUnit()); }
  function amplitudeUnit(mode) { return mode==='linear' ? 'Amplitude' : mode==='dba' ? 'dBA' : 'dB'; }
  function updateLinearUnitLabels() { /* 소음/진동 패널에 고정 라벨 사용 */ }
  function getChannelTypeSettings(channel) {
    const type = channel?.channelType === 'noise' ? 'noise' : 'vibration';
    return type === 'noise'
      ? { mode:$('noiseAmplitudeMode').value, sourceDbReference:Number($('noiseSourceDbReference').value), orderDbReference:Number($('noiseOrderDbReference').value) }
      : { mode:$('vibrationAmplitudeMode').value, sourceDbReference:Number($('vibrationSourceDbReference').value), orderDbReference:Number($('vibrationOrderDbReference').value) };
  }
  function convertAmplitude(amplitude, frequency, mode, reference, sourceUnit, sourceDbReference) {
    if (!Number.isFinite(amplitude)) return NaN;
    const nativeUnit = sourceUnit || detectedAmplitudeUnit();
    const nativeDb = isDbScaleUnit(nativeUnit);
    const nativeDba = isDbaUnit(nativeUnit);

    // Noise dB/dBA는 정규화 단계에서 Pa로 변환되어 들어오므로
    // 정상적인 Noise 분석 경로에서는 이 분기에 진입하지 않습니다.
    // Vibration의 기존 dB 입력 처리 및 예외적인 원본 dB 데이터 호환성을 위해 유지합니다.
    if (nativeDb) {
      const sourceRef = Number(sourceDbReference);
      if (!(sourceRef > 0)) return NaN;
      const sourceDb = nativeDba ? amplitude - aWeighting(frequency) : amplitude;
      const linearAmplitude = sourceRef * Math.pow(10, sourceDb / 20);
      if (!(linearAmplitude > 0)) return NaN;
      if (mode==='linear') return linearAmplitude;
      if (!(reference > 0)) return NaN;
      const db = 20 * Math.log10(linearAmplitude / reference);
      return mode==='dba' ? db + aWeighting(frequency) : db;
    }
    if (mode==='linear') return amplitude;
    if (!(amplitude>0) || !(reference>0)) return NaN;
    const db=20*Math.log10(amplitude/reference);
    return mode==='dba' ? db + aWeighting(frequency) : db;
  }

  function aWeighting(f) {
    if (!(f>0)) return -Infinity;
    const f2=f*f;
    const ra=(12194*12194*f2*f2)/((f2+20.6*20.6)*Math.sqrt((f2+107.7*107.7)*(f2+737.9*737.9))*(f2+12194*12194));
    return 20*Math.log10(ra)+2.0;
  }
  function updateReferenceHelp() { /* 소음/진동 개별 설정 패널 사용 */ }
  function syncSpectrumMapToOrderAnalysis(channel, channelId) {
    if (!channel) return;
    if (channelId && currentReport?.normalized?.channels?.[channelId]) $('mapChannelSelect').value = channelId;
  }

  function syncSpectrumMapChannelOptions(channelIds) {
    const select=$('mapChannelSelect');
    if (!select || !currentReport) return;
    const ids=(channelIds || []).filter(id => currentReport.normalized.channels[id]);
    const previous=select.value;
    select.innerHTML=ids.map(id=>{
      const ch=currentReport.normalized.channels[id];
      return `<option value="${escapeHtml(id)}">${escapeHtml(channelDisplayName(ch))}</option>`;
    }).join('');
    if (ids.includes(previous)) select.value=previous;
    else if (ids.length) select.value=ids[0];
    const channel=currentReport.normalized.channels[select.value];
    if (!channel) return;
    syncSpectrumMapToOrderAnalysis(channel, select.value);
    if (mapXAxisMode === 'order') initializeMapOrderAxisInputs();
    else setMapFrequencyRangeFromData();
    initializeMapAxisInputs();
    updateMapColorAxisInputs();
    spectrumMapHover = null;
    spectrumMapGeometry = null;
    requestAnimationFrame(() => renderMultiColorMap());
  }

  function initializeMapChannelOptions(report) {
    if (!report) return;
    syncSpectrumMapChannelOptions(report.normalized.channelOrder);
  }

  function getChannelFrequencyRange(channel) {
    if (!channel) return null;
    let min=Infinity, max=-Infinity;
    for (const spectrum of Object.values(channel.spectraByRpm)) {
      if (Number.isFinite(spectrum.minFrequency)) min=Math.min(min,spectrum.minFrequency);
      if (Number.isFinite(spectrum.maxFrequency)) max=Math.max(max,spectrum.maxFrequency);
      if ((!Number.isFinite(spectrum.minFrequency) || !Number.isFinite(spectrum.maxFrequency)) && spectrum.frequency.length) {
        min=Math.min(min,safeMin(spectrum.frequency));
        max=Math.max(max,safeMax(spectrum.frequency));
      }
    }
    return Number.isFinite(min) && Number.isFinite(max) ? {min,max} : null;
  }

  function setMapFrequencyRangeFromData() {
    if (!currentReport) return;
    const channel=currentReport.normalized.channels[$('mapChannelSelect').value];
    const range=getChannelFrequencyRange(channel);
    if (!range) return;
    $('mapMinFrequency').value=formatInteger(range.min);
    $('mapMaxFrequency').value=formatInteger(range.max);
  }
  function getChannelOrderRange(channel) {
    if (!channel) return null;
    let min=Infinity, max=-Infinity;
    for (const spectrum of Object.values(channel.spectraByRpm)) {
      const rpm=Number(spectrum.rpm);
      if (!(rpm>0)) continue;
      const scale=rpm/60;
      if (!(scale>0)) continue;
      const fmin=Number.isFinite(spectrum.minFrequency) ? spectrum.minFrequency : safeMin(spectrum.frequency);
      const fmax=Number.isFinite(spectrum.maxFrequency) ? spectrum.maxFrequency : safeMax(spectrum.frequency);
      if (Number.isFinite(fmin)) min=Math.min(min,fmin/scale);
      if (Number.isFinite(fmax)) max=Math.max(max,fmax/scale);
    }
    return Number.isFinite(min)&&Number.isFinite(max)?{min,max}:null;
  }
  function initializeMapOrderAxisInputs(force=false) {
    if (!currentReport) return;
    const channel=currentReport.normalized.channels[$('mapChannelSelect').value];
    const range=getChannelOrderRange(channel);
    if (!range) return;
    // 채널 변경/최초 진입 시에만 데이터 범위를 자동 입력합니다.
    // 사용자가 직접 입력한 최소/최대 오더는 Spectrum Map 재렌더링 과정에서 덮어쓰지 않습니다.
    const minInput=$('mapMinOrder'), maxInput=$('mapMaxOrder');
    if (force || minInput.value==='' || maxInput.value==='') {
      minInput.value=Number(range.min.toPrecision(6));
      maxInput.value=Number(range.max.toPrecision(6));
    }
  }
  function getMapOverlayOrders() {
    if (!$('mapOrderOverlayEnabled').checked) return [];
    return uniqueSorted(String($('mapOrderOverlayInput').value || '')
      .split(/[\s,;]+/)
      .map(Number)
      .filter(v => Number.isFinite(v) && v > 0));
  }

  function renderMultiColorMap() {
    if(!currentReport)return;
    const channelId = $('mapChannelSelect').value;
    const channel = currentReport.normalized.channels[channelId];
    if (!channel) return;
    const mapSettings = getChannelTypeSettings(channel);
    const activeMapReference = Number(mapSettings.orderDbReference);
    if (!(activeMapReference > 0) || !Number.isFinite(activeMapReference)) return;
    const overlayOrders=getMapOverlayOrders();
    const mapOutputElements=[$('spectrumMapFrame'),$('spectrumMapNote'),$('multiMapNote')].filter(Boolean);
    mapOutputElements.forEach(el=>el.classList.remove('analysis-output-hidden'));
    const canvas=$('multiColorMapCanvas');
    const mode=mapSettings.mode,reference=activeMapReference;
    const sourceRef=mapSettings.sourceDbReference;
    const frame=$('spectrumMapFrame'),width=Math.max(500,frame.clientWidth),height=Math.max(300,frame.clientHeight),dpr=Math.max(1,devicePixelRatio||1);
    canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.width=width+'px';canvas.style.height=height+'px';
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=isDarkMode()?'#151e27':'#fff';ctx.fillRect(0,0,width,height);

    const allRpms=uniqueSorted(Object.keys(channel.spectraByRpm).map(Number));
    const dataRpmMin=safeMin(allRpms),dataRpmMax=safeMax(allRpms);
    let rpmMin=optionalNumber($('mapRpmMin').value,dataRpmMin),rpmMax=optionalNumber($('mapRpmMax').value,dataRpmMax);
    if(!(rpmMax>=rpmMin)){rpmMin=dataRpmMin;rpmMax=dataRpmMax;}
    const rpms=allRpms.filter(r=>r>=rpmMin&&r<=rpmMax);
    if(!rpms.length){drawCanvasMessage(ctx,width,height,'선택 RPM 범위에 표시 가능한 데이터가 없습니다.');return;}

    let axisMin,axisMax;
    if(mapXAxisMode==='order'){
      initializeMapOrderAxisInputs(false);
      const range=getChannelOrderRange(channel);
      axisMin=optionalNumber($('mapMinOrder').value,range?.min);
      axisMax=optionalNumber($('mapMaxOrder').value,range?.max);
    }else{
      const range=getChannelFrequencyRange(channel);
      axisMin=optionalNumber($('mapMinFrequency').value,range?.min);
      axisMax=optionalNumber($('mapMaxFrequency').value,range?.max);
    }
    if(!(Number.isFinite(axisMin)&&Number.isFinite(axisMax))||axisMin>=axisMax){drawCanvasMessage(ctx,width,height,'가로축 조건을 확인하십시오.');return;}

    const vals=[];
    let maxPoint=null;
    for(const rpm of rpms){
      const sp=channel.spectraByRpm[String(rpm)];
      for(let i=0;i<sp.frequency.length;i++){
        const f=sp.frequency[i];
        const xValue=mapXAxisMode==='order' ? f/(rpm/60) : f;
        if(xValue<axisMin||xValue>axisMax)continue;
        const v=convertAmplitude(sp.amplitude[i],f,mode,reference,sp.yUnit,sourceRef);
        if(Number.isFinite(v)){
          vals.push(v);
          if(!maxPoint || v>maxPoint.value){
            maxPoint={value:v,rpm,frequency:f,order:f/(rpm/60),xValue};
          }
        }
      }
    }
    if(!vals.length){drawCanvasMessage(ctx,width,height,'선택 범위에 표시 가능한 데이터가 없습니다.');return;}
    const dataVMin=safeMin(vals),dataVMax=safeMax(vals);
    let vMin=optionalNumber($('mapAmpMin').value,dataVMin),vMax=optionalNumber($('mapAmpMax').value,dataVMax);
    if(!(vMax>vMin)){vMin=dataVMin;vMax=dataVMax;} if(vMax===vMin)vMax=vMin+1e-12;

    const m={left:74,right:28,top:28,bottom:55},pw=width-m.left-m.right,ph=height-m.top-m.bottom,bh=ph/rpms.length;
    spectrumMapGeometry={channelId,channel,rpms,fMin:mapXAxisMode==='frequency'?axisMin:0,fMax:mapXAxisMode==='frequency'?axisMax:0,axisMin,axisMax,xAxisMode:mapXAxisMode,rpmMin,rpmMax,mode,reference,sourceRef,m,pw,ph,bh,width,height,maxPoint};
    rpms.forEach((rpm,ri)=>{
      const sp=channel.spectraByRpm[String(rpm)],yy=m.top+(rpms.length-1-ri)*bh,scale=rpm/60;
      for(let i=0;i<sp.frequency.length;i++){
        const f=sp.frequency[i];
        const xValue=mapXAxisMode==='order' ? f/scale : f;
        if(xValue<axisMin||xValue>axisMax)continue;
        const v=convertAmplitude(sp.amplitude[i],f,mode,reference,sp.yUnit,sourceRef);if(!Number.isFinite(v))continue;
        const nextF=i+1<sp.frequency.length?sp.frequency[i+1]:f+sp.frequencyResolution;
        const nextX=mapXAxisMode==='order'?nextF/scale:nextF;
        const x1=m.left+(xValue-axisMin)/(axisMax-axisMin)*pw;
        const x2=m.left+(Math.min(nextX,axisMax)-axisMin)/(axisMax-axisMin)*pw;
        ctx.fillStyle=amplitudeColor((v-vMin)/(vMax-vMin));ctx.fillRect(x1,yy,Math.max(1,x2-x1+.4),bh+.5);
      }
    });

    // 현재 표시 범위에서의 최대값 위치를 그래프에 직접 표시합니다.
    if(maxPoint){
      const maxX=m.left+(maxPoint.xValue-axisMin)/(axisMax-axisMin)*pw;
      const maxRi=rpms.indexOf(maxPoint.rpm);
      const maxY=m.top+(rpms.length-1-maxRi+.5)*bh;
      ctx.save();
      ctx.beginPath();ctx.rect(m.left,m.top,pw,ph);ctx.clip();
      ctx.strokeStyle=isDarkMode()?'rgba(255,255,255,.95)':'rgba(0,0,0,.85)';
      ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(maxX-8,maxY);ctx.lineTo(maxX+8,maxY);ctx.moveTo(maxX,maxY-8);ctx.lineTo(maxX,maxY+8);ctx.stroke();
      ctx.beginPath();ctx.arc(maxX,maxY,5,0,Math.PI*2);ctx.fillStyle=isDarkMode()?'#ffffff':'#111827';ctx.fill();ctx.strokeStyle=isDarkMode()?'#111827':'#ffffff';ctx.lineWidth=2;ctx.stroke();
      ctx.restore();
      const maxLabel=`MAX ${formatGraphSig4(maxPoint.value)} ${amplitudeUnit(mode)} · ${formatInteger(maxPoint.rpm)} rpm · ${formatGraphSig4(maxPoint.order)}X`;
      ctx.save();ctx.font='bold 11px Malgun Gothic, sans-serif';
      const lw=ctx.measureText(maxLabel).width+18;
      let lx=maxX+10,ly=maxY-30;
      if(lx+lw>m.left+pw)lx=maxX-lw-10;
      if(ly<m.top+4)ly=maxY+10;
      if(ly+20>m.top+ph)ly=Math.max(m.top+4,m.top+ph-20);
      ctx.fillStyle=isDarkMode()?'rgba(20,28,36,.94)':'rgba(255,255,255,.94)';ctx.strokeStyle=isDarkMode()?'rgba(255,255,255,.8)':'rgba(30,40,50,.75)';ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect(lx,ly,lw,20,4);ctx.fill();ctx.stroke();
      ctx.fillStyle=isDarkMode()?'#ffffff':'#111827';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(maxLabel,lx+9,ly+10);ctx.restore();
    }

    ctx.save();ctx.beginPath();ctx.rect(m.left,m.top,pw,ph);ctx.clip();
    overlayOrders.forEach((order,orderIndex)=>{
      const points=rpms.map((rpm,ri)=>{
        const xValue=mapXAxisMode==='order'?order:order*rpm/60;
        return {f:order*rpm/60,order,xValue,x:m.left+(xValue-axisMin)/(axisMax-axisMin)*pw,y:m.top+(rpms.length-1-ri+.5)*bh,rpm};
      }).filter(p=>p.xValue>=axisMin&&p.xValue<=axisMax);
      if(!points.length)return;
      ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.strokeStyle=`hsla(${(orderIndex*67+205)%360},90%,96%,0.88)`;ctx.lineWidth=1.2;ctx.setLineDash([5,4]);ctx.stroke();
      const labelPoint=points[points.length-1];ctx.setLineDash([]);ctx.font='bold 11px Malgun Gothic, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
      const label=`${formatGraphSig4(order)}X`;const tx=Math.min(labelPoint.x+4,m.left+pw-ctx.measureText(label).width-4),ty=Math.max(m.top+8,Math.min(m.top+ph-8,labelPoint.y));
      ctx.lineWidth=3;ctx.strokeStyle='rgba(0,0,0,.55)';ctx.strokeText(label,tx,ty);ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillText(label,tx,ty);
    });
    ctx.restore();

    const tc=graphThemeColors();ctx.font='12px Malgun Gothic, sans-serif';ctx.fillStyle=tc.text;ctx.textAlign='right';ctx.textBaseline='middle';rpms.forEach((rpm,ri)=>ctx.fillText(rpm,m.left-9,m.top+(rpms.length-1-ri+.5)*bh));
    // X축: Frequency는 기존 10분할, Order는 정수 오더를 기준으로 눈금/세로 가이드선을 표시합니다.
    ctx.textAlign='center';ctx.textBaseline='top';
    if(mapXAxisMode==='order'){
      const integerStart=Math.ceil(axisMin), integerEnd=Math.floor(axisMax);
      const integerCount=Math.max(0,integerEnd-integerStart+1);
      const labelStep=integerCount<=24 ? 1 : Math.max(1,Math.ceil(integerCount/12));
      const selectedOrders=overlayOrders.filter(o=>o>=axisMin&&o<=axisMax);
      for(let order=integerStart;order<=integerEnd;order++){
        const x=m.left+(order-axisMin)/(axisMax-axisMin)*pw;
        const isSelected=selectedOrders.some(o=>Math.abs(o-order)<1e-9);
        ctx.save();
        ctx.strokeStyle=isSelected ? (isDarkMode()?'rgba(255,235,120,.75)':'rgba(82,72,20,.45)') : (isDarkMode()?'rgba(190,205,220,.13)':'rgba(90,105,120,.12)');
        ctx.lineWidth=isSelected?1.4:0.7;
        ctx.setLineDash(isSelected?[4,3]:[2,4]);
        ctx.beginPath();ctx.moveTo(x,m.top);ctx.lineTo(x,m.top+ph);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle=isSelected ? tc.text : tc.text;
        ctx.font=isSelected ? 'bold 11px Malgun Gothic, sans-serif' : '11px Malgun Gothic, sans-serif';
        if((order-integerStart)%labelStep===0 || isSelected) ctx.fillText(String(order),x,m.top+ph+8);
        ctx.restore();
      }
      // 범위 끝이 정수 눈금 사이에 있더라도 최소/최대 위치를 보조 눈금으로 표시합니다.
      [axisMin,axisMax].forEach(v=>{
        if(Math.abs(v-Math.round(v))<1e-9)return;
        const x=m.left+(v-axisMin)/(axisMax-axisMin)*pw;
        ctx.strokeStyle=tc.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,m.top+ph);ctx.lineTo(x,m.top+ph+5);ctx.stroke();
      });
    }else{
      for(let i=0;i<=10;i++){const xValue=axisMin+(axisMax-axisMin)*i/10,x=m.left+pw*i/10;ctx.fillText(formatInteger(xValue),x,m.top+ph+8);}
    }
    ctx.strokeStyle=tc.border;ctx.lineWidth=1;ctx.strokeRect(m.left,m.top,pw,ph);ctx.font='bold 12px Malgun Gothic, sans-serif';ctx.fillStyle=tc.text;ctx.fillText(mapXAxisMode==='order'?'Order (X)':'Frequency (Hz)',m.left+pw/2,height-20);ctx.save();ctx.translate(18,m.top+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText('RPM',0,0);ctx.restore();
    drawSpectrumMapHover(ctx, overlayOrders);
    $('mapLegendUnit').textContent='진폭 ('+amplitudeUnit(mode)+')';
    const legendValues=Array.from({length:5},(_,i)=>vMin+(vMax-vMin)*i/4);$('mapLegendTicks').innerHTML=legendValues.map(value=>`<span>${escapeHtml(formatColorLegendTick(value,mode))}</span>`).join('');
    if(maxPoint){
      const maxInfo=`최대값: ${formatGraphSig4(maxPoint.value)} ${amplitudeUnit(mode)} · ${formatInteger(maxPoint.rpm)} rpm · ${formatGraphSig4(maxPoint.order)}X · ${formatGraphSig4(maxPoint.frequency)} Hz`;
      $('spectrumMapMaxInfo').textContent=maxInfo;
    }else{
      $('spectrumMapMaxInfo').textContent='';
    }
    $('multiMapNote').textContent=`${channelId} · ${mapXAxisMode==='order' ? formatNumber(axisMin)+'~'+formatNumber(axisMax)+' X' : formatInteger(axisMin)+'~'+formatInteger(axisMax)+' Hz'} · ${formatInteger(rpmMin)}~${formatInteger(rpmMax)} rpm · ${amplitudeUnit(mode)} 표시${overlayOrders.length ? ' · 오더 '+overlayOrders.map(formatNumber).join(', ')+'X' : ''}`;
  }

  function drawSpectrumMapHover(ctx, overlayOrders) {
    const g=spectrumMapGeometry,h=spectrumMapHover;
    if(!g||!h||!g.rpms.length)return;
    const {m,pw,ph,bh,axisMin,axisMax,channel,channelId,mode,reference,sourceRef,width,height,rpms,xAxisMode}=g;
    if(h.x<m.left||h.x>m.left+pw||h.y<m.top||h.y>m.top+ph)return;
    const peakSearchWidth=Number($('multiSearchWidth').value);if(!Number.isFinite(peakSearchWidth)||peakSearchWidth<0)return;
    let nearest=null;
    rpms.forEach((rpm,ri)=>{
      const y=m.top+(rpms.length-1-ri+.5)*bh;
      overlayOrders.forEach(order=>{
        const theoreticalFrequency=order*rpm/60;
        const xValue=xAxisMode==='order'?order:theoreticalFrequency;
        if(xValue<axisMin||xValue>axisMax)return;
        const x=m.left+(xValue-axisMin)/(axisMax-axisMin)*pw;
        const distance=Math.hypot(x-h.x,y-h.y);
        if(!nearest||distance<nearest.distance)nearest={rpm,order,theoreticalFrequency,x,y,distance};
      });
    });
    if(!nearest||nearest.distance>Math.max(36,bh*0.8))return;
    const spectrum=channel.spectraByRpm[String(nearest.rpm)];
    const searchMin=Math.max(spectrum.minFrequency,nearest.theoreticalFrequency-peakSearchWidth),searchMax=Math.min(spectrum.maxFrequency,nearest.theoreticalFrequency+peakSearchWidth);
    let peakIndex=-1,peakRawAmplitude=-Infinity;
    if(peakSearchWidth===0){let nearestBinDistance=Infinity;for(let i=0;i<spectrum.frequency.length;i++){const f=spectrum.frequency[i],a=spectrum.amplitude[i];if(!Number.isFinite(f)||!Number.isFinite(a))continue;const d=Math.abs(f-nearest.theoreticalFrequency);if(d<nearestBinDistance){nearestBinDistance=d;peakIndex=i;peakRawAmplitude=a;}}}
    else{for(let i=0;i<spectrum.frequency.length;i++){const f=spectrum.frequency[i],a=spectrum.amplitude[i];if(f>=searchMin&&f<=searchMax&&Number.isFinite(a)&&a>peakRawAmplitude){peakIndex=i;peakRawAmplitude=a;}}}
    if(peakIndex<0)return;
    const peakFrequency=spectrum.frequency[peakIndex],displayAmplitude=convertAmplitude(peakRawAmplitude,peakFrequency,mode,reference,spectrum.yUnit,sourceRef),peakOrder=peakFrequency/(nearest.rpm/60),peakX=m.left+((xAxisMode==='order'?peakOrder:peakFrequency)-axisMin)/(axisMax-axisMin)*pw,unit=amplitudeUnit(mode);
    ctx.save();ctx.beginPath();ctx.arc(peakX,nearest.y,7,0,Math.PI*2);ctx.fillStyle=isDarkMode()?'#dbe4ec':'rgba(255,255,255,.95)';ctx.fill();ctx.strokeStyle=isDarkMode()?'#111827':'#111827';ctx.lineWidth=2;ctx.stroke();
    const lines=[channelId+' · '+formatGraphSig4(nearest.order)+'X','RPM: '+formatInteger(nearest.rpm),'이론 오더 주파수: '+formatGraphSig4(nearest.theoreticalFrequency)+' Hz','검출 피크 주파수: '+formatGraphSig4(peakFrequency)+' Hz','검출 피크 오더: '+formatGraphSig4(peakOrder)+'X','피크 검색 범위: '+formatGraphSig4(searchMin)+' ~ '+formatGraphSig4(searchMax)+' Hz','피크 진폭: '+formatGraphSig4(displayAmplitude)+' '+unit];
    ctx.font='12px Malgun Gothic, sans-serif';const boxWidth=Math.max(...lines.map(line=>ctx.measureText(line).width))+22,boxHeight=lines.length*19+17;let boxX=h.x+14,boxY=h.y-boxHeight-12;if(boxX+boxWidth>width-6)boxX=h.x-boxWidth-14;if(boxY<6)boxY=h.y+14;if(boxY+boxHeight>height-6)boxY=Math.max(6,height-boxHeight-6);
    ctx.fillStyle=graphThemeColors().tooltipBg;ctx.strokeStyle=isDarkMode()?'rgba(220,230,240,.9)':'rgba(255,255,255,.9)';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(boxX,boxY,boxWidth,boxHeight,6);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='top';lines.forEach((line,index)=>ctx.fillText(line,boxX+11,boxY+8+index*19));ctx.restore();
  }

  function formatFrequency2(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '-';
  }
  function formatSignedFrequency2(value) {
    if (!Number.isFinite(Number(value))) return '-';
    const number=Number(value);
    if (Math.abs(number) < 0.005) return '0.00';
    return (number > 0 ? '+' : '') + number.toFixed(2);
  }

  function formatColorLegendTick(value, mode) {
    if (!Number.isFinite(value)) return '-';
    if (mode === 'db' || mode === 'dba') return String(Math.round(value));
    if (value === 0) return '0';
    const absolute=Math.abs(value);
    if (absolute >= 0.01 && absolute < 10000) return Number(value.toPrecision(2)).toString();
    return value.toExponential(1).replace('e+', 'e');
  }

  function optionalNumber(value, fallback) {
    if (String(value).trim()==='') return fallback;
    const n=Number(value); return Number.isFinite(n)?n:fallback;
  }
  function isDarkMode() { return document.body.classList.contains('dark-mode'); }
  function graphThemeColors() {
    return isDarkMode()
      ? { grid:'#3a4653', axis:'#b8c4d0', text:'#dbe4ec', border:'#7f8b97', tooltipBg:'rgba(18,25,33,.97)' }
      : { grid:'#d6dde5', axis:'#5d6975', text:'#33404d', border:'#65717d', tooltipBg:'rgba(17,24,39,.95)' };
  }

  function drawAxesRange(ctx,margin,plotW,plotH,xMin,xMax,yMin,yMax,xLabel,yLabel,yFormatter,xTickValues) {
    const tc=graphThemeColors();ctx.strokeStyle=tc.grid;ctx.lineWidth=1;ctx.font='11px Malgun Gothic, sans-serif';
    for(let i=0;i<=5;i++){
      const yy=margin.top+plotH*i/5,val=yMax-(yMax-yMin)*i/5;
      ctx.beginPath();ctx.moveTo(margin.left,yy);ctx.lineTo(margin.left+plotW,yy);ctx.stroke();
      ctx.fillStyle=tc.axis;ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(yFormatter(val),margin.left-8,yy);
    }
    ctx.fillStyle=tc.axis;ctx.textAlign='center';ctx.textBaseline='top';
    const ticks=Array.isArray(xTickValues)&&xTickValues.length
      ? uniqueSorted(xTickValues.filter(v=>Number.isFinite(v)&&v>=xMin&&v<=xMax))
      : Array.from({length:6},(_,i)=>xMin+(xMax-xMin)*i/5);
    ticks.forEach(val=>{
      const xx=margin.left+(xMax===xMin?.5:(val-xMin)/(xMax-xMin))*plotW;
      ctx.fillText(formatInteger(val),xx,margin.top+plotH+8);
    });
    ctx.strokeStyle=tc.border;ctx.strokeRect(margin.left,margin.top,plotW,plotH);
    ctx.font='bold 12px Malgun Gothic, sans-serif';ctx.fillText(xLabel,margin.left+plotW/2,margin.top+plotH+30);
    ctx.save();ctx.translate(16,margin.top+plotH/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillText(yLabel,0,0);ctx.restore();
  }

  function renderOrderSection(report) {
    const select = $('orderChannelSelect');
    select.innerHTML = report.normalized.channelOrder.map(id => {
      const ch = report.normalized.channels[id];
      return `<option value="${escapeHtml(id)}">${escapeHtml(channelDisplayName(ch))}</option>`;
    }).join('');
    renderOrderAnalysis();
  }

  function calculateOrderRows(channel, order, searchHalfWidth, sumHalfWidth, matchTolerance) {
    const rows = [];
    const rpms = uniqueSorted(Object.keys(channel.spectraByRpm).map(Number));
    for (const rpm of rpms) {
      const spectrum = channel.spectraByRpm[String(rpm)];
      const rotationFrequency = rpm / 60;
      const targetFrequency = order * rotationFrequency;
      const searchMin = Math.max(spectrum.minFrequency, targetFrequency - searchHalfWidth);
      const searchMax = Math.min(spectrum.maxFrequency, targetFrequency + searchHalfWidth);
      let peakIndex = -1;
      let peakAmplitude = -Infinity;
      if (searchHalfWidth === 0) {
        let nearestDistance = Infinity;
        for (let i = 0; i < spectrum.frequency.length; i++) {
          const f = spectrum.frequency[i];
          const a = spectrum.amplitude[i];
          if (!Number.isFinite(f) || !Number.isFinite(a)) continue;
          const distance = Math.abs(f - targetFrequency);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            peakAmplitude = a;
            peakIndex = i;
          }
        }
      } else {
        for (let i = 0; i < spectrum.frequency.length; i++) {
          const f = spectrum.frequency[i];
          const a = spectrum.amplitude[i];
          if (f >= searchMin && f <= searchMax && Number.isFinite(a) && a > peakAmplitude) {
            peakAmplitude = a;
            peakIndex = i;
          }
        }
      }
      const inRange = targetFrequency >= spectrum.minFrequency && targetFrequency <= spectrum.maxFrequency;
      const peakFrequency = peakIndex >= 0 ? spectrum.frequency[peakIndex] : NaN;
      const sumMin = peakIndex >= 0 ? Math.max(spectrum.minFrequency, peakFrequency - sumHalfWidth) : NaN;
      const sumMax = peakIndex >= 0 ? Math.min(spectrum.maxFrequency, peakFrequency + sumHalfWidth) : NaN;
      let orderAmplitude = 0;
      let sumOfSquares = 0;
      let levelEnergySum = 0;
      let summedPointCount = 0;
      const sourceDbScale = isDbScaleUnit(spectrum.yUnit);
      const accumulateAmplitude = a => {
        if (!Number.isFinite(a)) return;
        if (sourceDbScale) levelEnergySum += Math.pow(10, a / 10);
        else sumOfSquares += a * a;
        summedPointCount++;
      };
      if (peakIndex >= 0) {
        if (sumHalfWidth === 0) accumulateAmplitude(spectrum.amplitude[peakIndex]);
        else {
          for (let i = 0; i < spectrum.frequency.length; i++) {
            const f = spectrum.frequency[i];
            if (f >= sumMin && f <= sumMax) accumulateAmplitude(spectrum.amplitude[i]);
          }
        }
        if (summedPointCount > 0) orderAmplitude = sourceDbScale ? 10*Math.log10(levelEnergySum) : Math.sqrt(sumOfSquares);
      }
      const frequencyDeviation = peakIndex >= 0 ? peakFrequency - targetFrequency : NaN;
      const deviationPercent = targetFrequency !== 0 && Number.isFinite(frequencyDeviation)
        ? Math.abs(frequencyDeviation) / targetFrequency * 100 : NaN;
      const actualOrder = peakIndex >= 0 ? peakFrequency / rotationFrequency : NaN;
      const matched = inRange && peakIndex >= 0 && Math.abs(frequencyDeviation) <= searchHalfWidth + 1e-12;
      rows.push({
        rpm, curveNo: spectrum.curveNo, rotationFrequency, order, targetFrequency,
        searchMin, searchMax, searchHalfWidth, peakIndex, peakFrequency, frequencyDeviation,
        sumMin, sumMax, sumHalfWidth, summedPointCount,
        deviationPercent, actualOrder, peakAmplitude: peakIndex >= 0 ? peakAmplitude : NaN,
        orderAmplitude: peakIndex >= 0 && summedPointCount > 0 ? orderAmplitude : NaN,
        sourceUnit: spectrum.yUnit, physicalUnit: spectrum.physicalUnit, inputScale: spectrum.inputScale,
        inRange, matched
      });
    }
    return rows;
  }

  function renderOrderAnalysis() {
    if (!currentReport) return;
    const channelId = $('orderChannelSelect').value;
    const channel = currentReport.normalized.channels[channelId];
    const order = Number($('orderInput').value);
    const searchHalfWidth = Number($('peakSearchInput').value);
    const sumHalfWidth = Number($('sumWidthInput').value);
    const matchTolerance = Number($('matchToleranceInput').value);
    if (!channel || !Number.isFinite(order) || order < 0 || !Number.isFinite(searchHalfWidth) || searchHalfWidth < 0 || !Number.isFinite(sumHalfWidth) || sumHalfWidth < 0 || !Number.isFinite(matchTolerance) || matchTolerance < 0) {
      $('orderSummary').innerHTML = '';
      $('orderBody').innerHTML = '<tr><td colspan="11" class="error-text">오더, 피크 검색 범위, 합산 범위 및 허용오차에 0 이상의 유효한 값을 입력하십시오.</td></tr>';
      renderOrderCharts([]);
      renderColorMap();
      return;
    }
    const rows = calculateOrderRows(channel, order, searchHalfWidth, sumHalfWidth, matchTolerance);
    const validRows = rows.filter(r => r.inRange && Number.isFinite(r.peakAmplitude));
    const maxRow = validRows.length ? validRows.reduce((a,b) => b.peakAmplitude > a.peakAmplitude ? b : a) : null;
    const matchedCount = rows.filter(r => r.matched).length;
    const maxDeviation = validRows.length ? safeMax(validRows.map(r => Math.abs(r.frequencyDeviation))) : NaN;
    const summary = [
      ['선택 채널', channelDisplayName(channel)],
      ['요청 오더', formatNumber(order)],
      ['피크 검색 범위', `±${formatNumber(searchHalfWidth)} Hz`],
      ['피크 중심 합산 범위', `±${formatNumber(sumHalfWidth)} Hz`],
      ['오더 주파수 허용 오차', `±${formatNumber(matchTolerance)} Hz`],
      ['일치 RPM', `${matchedCount} / ${rows.length}`],
      ['최대 주파수 편차', `${formatNumber(maxDeviation)} Hz`],
      ['최대 피크 진폭 RPM', maxRow ? `${maxRow.rpm} rpm` : '-'],
      ['최대 시험 피크 진폭', maxRow ? `${formatScientific(maxRow.peakAmplitude)} g` : '-']
    ];
    $('orderSummary').innerHTML = summary.map(([label,value]) =>
      `<div class="summary-item order-kpi"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(String(value))}</span></div>`
    ).join('');
    $('orderBody').innerHTML = rows.map(r => {
      const valid = r.inRange && Number.isFinite(r.peakAmplitude);
      const isMax = maxRow && r.rpm === maxRow.rpm;
      const badgeClass = !valid ? 'error' : r.matched ? 'ok' : 'warn';
      const statusText = !valid ? '범위 밖' : r.matched ? '일치' : '불일치';
      return `<tr class="${isMax ? 'highlight-row' : ''}">
        <td class="num">${r.rpm}</td>
        <td class="num">${formatFixed(r.rotationFrequency, 3)}</td>
        <td class="num">${formatNumber(r.order)}</td>
        <td class="num">${formatFixed(r.targetFrequency, 3)}</td>
        <td class="num">${formatNumber(r.searchMin)} ~ ${formatNumber(r.searchMax)}</td>
        <td class="num"><strong>${formatNumber(r.peakFrequency)}</strong></td>
        <td class="num">${formatSigned(r.frequencyDeviation, 3)}</td>
        <td class="num">${formatFixed(r.deviationPercent, 3)}</td>
        <td class="num">${formatFixed(r.actualOrder, 3)}</td>
        <td class="num">${formatScientific(r.peakAmplitude)}</td>
        <td><span class="badge ${badgeClass}">${statusText}</span> <span class="small">Curve ${r.curveNo}</span></td>
      </tr>`;
    }).join('');
    renderOrderCharts(rows);
    renderColorMap();
  }

  function renderOrderCharts(rowsOverride) {
    const channelId = currentReport && $('orderChannelSelect').value;
    const channel = currentReport && currentReport.normalized.channels[channelId];
    const order = Number($('orderInput').value);
    const searchHalfWidth = Number($('peakSearchInput').value);
    const sumHalfWidth = Number($('sumWidthInput').value);
    const matchTolerance = Number($('matchToleranceInput').value);
    let rows = rowsOverride;
    if (!Array.isArray(rows)) {
      rows = channel && Number.isFinite(order) && Number.isFinite(searchHalfWidth) && Number.isFinite(sumHalfWidth) && Number.isFinite(matchTolerance)
        ? calculateOrderRows(channel, order, searchHalfWidth, sumHalfWidth, matchTolerance) : [];
    }
    drawAmplitudeChart($('orderAmplitudeCanvas'), rows, channel, order);
    drawFrequencyChart($('orderFrequencyCanvas'), rows, channel, order, matchTolerance);
  }

  function prepareChartCanvas(canvas) {
    if (!canvas) return null;
    const width = Math.max(430, canvas.parentElement.clientWidth || 430);
    const height = 330;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    canvas.style.width=width+'px'; canvas.style.height=height+'px';
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    return {ctx,width,height,margin:{left:68,right:24,top:22,bottom:52}};
  }

  function drawAmplitudeChart(canvas, rows, channel, order) {
    const c=prepareChartCanvas(canvas); if(!c) return;
    const {ctx,width,height,margin}=c;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
    const settings=getChannelTypeSettings(channel);
    const displayRows=rows.map(r=>({...r,displayAmplitude:convertAmplitude(r.peakAmplitude,r.peakFrequency,settings.mode,settings.orderDbReference,r.sourceUnit,settings.sourceDbReference),displayUnit:amplitudeUnit(settings.mode)}));
    const valid=displayRows.filter(r=>Number.isFinite(r.displayAmplitude));
    if(!valid.length){drawCanvasMessage(ctx,width,height,'표시할 오더 진폭 데이터가 없습니다.');return;}
    const xVals=valid.map(r=>r.rpm), yVals=valid.map(r=>r.displayAmplitude);
    let yMin=safeMin(yVals), yMax=safeMax(yVals); if(settings.mode==='linear') yMin=Math.min(0,yMin);
    if(yMax===yMin)yMax=yMin+1e-9; else yMax*=1.12;
    const plotW=width-margin.left-margin.right, plotH=height-margin.top-margin.bottom;
    const xMin=safeMin(xVals), xMax=safeMax(xVals);
    const x=rpm=>margin.left+(xMax===xMin?.5:(rpm-xMin)/(xMax-xMin))*plotW;
    const y=v=>margin.top+plotH-(v-yMin)/(yMax-yMin)*plotH;
    const yUnit=valid[0].displayUnit || amplitudeUnit(settings.mode);
    drawAxes(ctx,margin,plotW,plotH,xVals,yMin,yMax,'RPM',`Amplitude (${yUnit})`,formatScientific);
    ctx.strokeStyle='#1769aa';ctx.lineWidth=2.5;ctx.beginPath();valid.forEach((r,i)=>i?ctx.lineTo(x(r.rpm),y(r.displayAmplitude)):ctx.moveTo(x(r.rpm),y(r.displayAmplitude)));ctx.stroke();
    valid.forEach(r=>{ctx.beginPath();ctx.arc(x(r.rpm),y(r.displayAmplitude),5,0,Math.PI*2);ctx.fillStyle='#1769aa';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();});
    ctx.fillStyle='#33404d';ctx.font='11px Malgun Gothic, sans-serif';ctx.textAlign='center';
    valid.forEach(r=>ctx.fillText(formatGraphSig4(r.displayAmplitude),x(r.rpm),Math.max(margin.top+10,y(r.displayAmplitude)-10)));
  }

  function drawFrequencyChart(canvas, rows, channel, order, tolerance) {
    const c=prepareChartCanvas(canvas); if(!c) return;
    const {ctx,width,height,margin}=c;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
    const valid=rows.filter(r=>Number.isFinite(r.targetFrequency)&&Number.isFinite(r.peakFrequency));
    if(!valid.length){drawCanvasMessage(ctx,width,height,'표시할 주파수 비교 데이터가 없습니다.');return;}
    const xVals=valid.map(r=>r.rpm), allY=valid.flatMap(r=>[r.targetFrequency,r.peakFrequency]);
    let yMin=safeMin(allY), yMax=safeMax(allY), pad=Math.max(5,(yMax-yMin)*.18);yMin-=pad;yMax+=pad;
    const plotW=width-margin.left-margin.right,plotH=height-margin.top-margin.bottom,xMin=safeMin(xVals),xMax=safeMax(xVals);
    const x=rpm=>margin.left+(xMax===xMin?.5:(rpm-xMin)/(xMax-xMin))*plotW;
    const y=v=>margin.top+plotH-(v-yMin)/(yMax-yMin)*plotH;
    drawAxes(ctx,margin,plotW,plotH,xVals,yMin,yMax,'RPM','Frequency (Hz)',v=>formatFixed(v,1));
    const drawSeries=(key,color)=>{ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();valid.forEach((r,i)=>i?ctx.lineTo(x(r.rpm),y(r[key])):ctx.moveTo(x(r.rpm),y(r[key])));ctx.stroke();};
    drawSeries('targetFrequency','#6b4bb8');drawSeries('peakFrequency','#d65b20');
    valid.forEach(r=>{
      ctx.beginPath();ctx.arc(x(r.rpm),y(r.targetFrequency),4,0,Math.PI*2);ctx.fillStyle='#6b4bb8';ctx.fill();
      ctx.beginPath();ctx.arc(x(r.rpm),y(r.peakFrequency),6,0,Math.PI*2);ctx.fillStyle=r.matched?'#16845b':'#ba2d2d';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    });
  }

  function drawAxes(ctx,margin,plotW,plotH,xValues,yMin,yMax,xLabel,yLabel,yFormatter) {
    ctx.strokeStyle='#d6dde5';ctx.lineWidth=1;ctx.font='11px Malgun Gothic, sans-serif';
    for(let i=0;i<=5;i++){
      const yy=margin.top+plotH*i/5, val=yMax-(yMax-yMin)*i/5;
      ctx.beginPath();ctx.moveTo(margin.left,yy);ctx.lineTo(margin.left+plotW,yy);ctx.stroke();
      ctx.fillStyle='#5d6975';ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(yFormatter(val),margin.left-8,yy);
    }
    ctx.fillStyle='#5d6975';ctx.textAlign='center';ctx.textBaseline='top';
    const xMin=safeMin(xValues),xMax=safeMax(xValues);
    xValues.forEach(v=>{const xx=margin.left+(xMax===xMin?.5:(v-xMin)/(xMax-xMin))*plotW;ctx.fillText(formatInteger(v),xx,margin.top+plotH+8);});
    ctx.strokeStyle='#65717d';ctx.strokeRect(margin.left,margin.top,plotW,plotH);
    ctx.font='bold 12px Malgun Gothic, sans-serif';ctx.fillText(xLabel,margin.left+plotW/2,margin.top+plotH+30);
    ctx.save();ctx.translate(16,margin.top+plotH/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillText(yLabel,0,0);ctx.restore();
  }

  function renderColorMap() {
    const canvas = $('colorMapCanvas');
    if (!canvas || !currentReport) return;
    const ctx = canvas.getContext('2d');
    const cssWidth = Math.max(760, canvas.parentElement.clientWidth || 760);
    const cssHeight = 500;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssWidth,cssHeight);

    const channelId = $('orderChannelSelect').value;
    const channel = currentReport.normalized.channels[channelId];
    const order = Number($('orderInput').value);
    const searchHalfWidth = Number($('peakSearchInput').value);
    const sumHalfWidth = Number($('sumWidthInput').value);
    const matchTolerance = Number($('matchToleranceInput').value);
    const minFreq = Number($('mapMinFreq').value);
    const maxFreq = Number($('mapMaxFreq').value);
    if (!channel || !Number.isFinite(order) || !Number.isFinite(searchHalfWidth) || !Number.isFinite(sumHalfWidth) || !Number.isFinite(matchTolerance) ||
        !Number.isFinite(minFreq) || !Number.isFinite(maxFreq) || minFreq >= maxFreq) {
      drawCanvasMessage(ctx, cssWidth, cssHeight, '유효한 표시 주파수 범위를 입력하십시오.');
      return;
    }

    const rpms = uniqueSorted(Object.keys(channel.spectraByRpm).map(Number));
    const margin = {left:76, right:92, top:34, bottom:58};
    const plotW = cssWidth - margin.left - margin.right;
    const plotH = cssHeight - margin.top - margin.bottom;
    const rows = calculateOrderRows(channel, order, searchHalfWidth, sumHalfWidth, matchTolerance);

    const samples = [];
    for (const rpm of rpms) {
      const sp = channel.spectraByRpm[String(rpm)];
      for (let i=0; i<sp.frequency.length; i++) {
        if (sp.frequency[i] >= minFreq && sp.frequency[i] <= maxFreq && Number.isFinite(sp.amplitude[i])) samples.push(sp.amplitude[i]);
      }
    }
    if (!samples.length) {
      drawCanvasMessage(ctx, cssWidth, cssHeight, '선택한 주파수 범위에 데이터가 없습니다.');
      return;
    }
    let ampMin = safeMin(samples), ampMax = safeMax(samples);
    if (ampMax === ampMin) ampMax = ampMin + 1e-12;
    $('legendMin').textContent = formatScientific(ampMin) + ' g';
    $('legendMax').textContent = formatScientific(ampMax) + ' g';

    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cssWidth,cssHeight);
    const bandH = plotH / rpms.length;
    for (let r=0; r<rpms.length; r++) {
      const rpm = rpms[r], sp = channel.spectraByRpm[String(rpm)];
      const y = margin.top + (rpms.length - 1 - r) * bandH;
      for (let i=0; i<sp.frequency.length; i++) {
        const f = sp.frequency[i];
        if (f < minFreq || f > maxFreq) continue;
        const nextF = i+1 < sp.frequency.length ? sp.frequency[i+1] : f + sp.frequencyResolution;
        const x1 = margin.left + (f-minFreq)/(maxFreq-minFreq)*plotW;
        const x2 = margin.left + (Math.min(nextF,maxFreq)-minFreq)/(maxFreq-minFreq)*plotW;
        const t = (sp.amplitude[i]-ampMin)/(ampMax-ampMin);
        ctx.fillStyle = amplitudeColor(t);
        ctx.fillRect(x1, y, Math.max(1, x2-x1+0.4), bandH+0.5);
      }
    }

    // grid, ticks, labels
    ctx.strokeStyle='rgba(255,255,255,.45)'; ctx.lineWidth=1;
    for (let i=0;i<=rpms.length;i++) {
      const y=margin.top+i*bandH; ctx.beginPath(); ctx.moveTo(margin.left,y); ctx.lineTo(margin.left+plotW,y); ctx.stroke();
    }
    ctx.fillStyle='#33404d'; ctx.font='12px Malgun Gothic, sans-serif'; ctx.textAlign='right'; ctx.textBaseline='middle';
    for (let r=0;r<rpms.length;r++) {
      const y=margin.top+(rpms.length-1-r+.5)*bandH; ctx.fillText(String(rpms[r]), margin.left-10,y);
    }
    ctx.textAlign='center'; ctx.textBaseline='top';
    const tickCount=10;
    for (let i=0;i<=tickCount;i++) {
      const f=minFreq+(maxFreq-minFreq)*i/tickCount;
      const x=margin.left+plotW*i/tickCount;
      ctx.strokeStyle='rgba(255,255,255,.35)'; ctx.beginPath();ctx.moveTo(x,margin.top);ctx.lineTo(x,margin.top+plotH);ctx.stroke();
      ctx.fillStyle='#33404d';ctx.fillText(formatNumber(round(f,2)),x,margin.top+plotH+9);
    }
    ctx.font='bold 13px Malgun Gothic, sans-serif'; ctx.fillText('Frequency (Hz)',margin.left+plotW/2,cssHeight-22);
    ctx.save();ctx.translate(20,margin.top+plotH/2);ctx.rotate(-Math.PI/2);ctx.fillText('RPM',0,0);ctx.restore();

    // theoretical order line
    const theoretical=[];
    for (const row of rows) if (row.targetFrequency>=minFreq && row.targetFrequency<=maxFreq) {
      theoretical.push({x:margin.left+(row.targetFrequency-minFreq)/(maxFreq-minFreq)*plotW,
        y:margin.top+(rpms.length-1-rpms.indexOf(row.rpm)+.5)*bandH});
    }
    if (theoretical.length) {
      ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=3;
      ctx.beginPath(); theoretical.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.shadowBlur=0;
    }
    // measured peak markers
    for (const row of rows) {
      if (!Number.isFinite(row.peakFrequency) || row.peakFrequency<minFreq || row.peakFrequency>maxFreq) continue;
      const x=margin.left+(row.peakFrequency-minFreq)/(maxFreq-minFreq)*plotW;
      const y=margin.top+(rpms.length-1-rpms.indexOf(row.rpm)+.5)*bandH;
      ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fillStyle='#111';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
    }
    ctx.strokeStyle='#65717d';ctx.lineWidth=1;ctx.strokeRect(margin.left,margin.top,plotW,plotH);
    $('colorMapMessage').textContent = `${channel.point} ${channel.direction}, ${formatNumber(order)}차 오더 | 주파수 ${formatNumber(minFreq)} ~ ${formatNumber(maxFreq)} Hz | 원 데이터 진폭의 선형 컬러스케일`;
  }

  function amplitudeColor(t) {
    t=Math.max(0,Math.min(1,t));
    const stops=[[0,[27,42,149]],[.18,[22,107,194]],[.36,[16,164,160]],[.55,[84,197,104]],[.72,[216,223,57]],[.86,[247,165,27]],[1,[214,47,39]]];
    for(let i=1;i<stops.length;i++) if(t<=stops[i][0]) {
      const [p0,c0]=stops[i-1], [p1,c1]=stops[i], u=(t-p0)/(p1-p0);
      const c=c0.map((v,j)=>Math.round(v+(c1[j]-v)*u)); return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
    return 'rgb(214,47,39)';
  }
  function drawCanvasMessage(ctx,w,h,text) {
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.fillStyle='#7b8794';ctx.font='15px Malgun Gothic, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,w/2,h/2);
    $('colorMapMessage').textContent=text;
  }
  function debounce(fn, wait) {
    let timer; return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait);};
  }


  function xlsxXmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
  function xlsxColumnName(n) {
    let name=''; n=Number(n)+1;
    while(n>0){const r=(n-1)%26;name=String.fromCharCode(65+r)+name;n=Math.floor((n-1)/26);}
    return name;
  }
  function xlsxCellXml(rowIndex,colIndex,value) {
    const ref=xlsxColumnName(colIndex)+(rowIndex+1);
    if(value===null || value===undefined || value==='') return `<c r="${ref}"/>`;
    if(typeof value==='number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    const text=String(value);
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xlsxXmlEscape(text)}</t></is></c>`;
  }
  function xlsxWorksheetXml(rows) {
    const safeRows=Array.isArray(rows)?rows:[];
    const maxCols=safeRows.reduce((m,r)=>Math.max(m,Array.isArray(r)?r.length:0),0);
    const dimension=maxCols && safeRows.length ? `A1:${xlsxColumnName(maxCols-1)}${safeRows.length}` : 'A1';
    const body=safeRows.map((row,ri)=>`<row r="${ri+1}">${(Array.isArray(row)?row:[]).map((v,ci)=>xlsxCellXml(ri,ci,v)).join('')}</row>`).join('');
    const cols=maxCols ? `<cols>${Array.from({length:maxCols},(_,i)=>`<col min="${i+1}" max="${i+1}" width="${i===0?18:15}" customWidth="1"/>`).join('')}</cols>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
      `<dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols}`+
      `<sheetData>${body}</sheetData></worksheet>`;
  }
  function xlsxZipBytes(entries) {
    const enc=new TextEncoder(), chunks=[], central=[]; let offset=0;
    const now=new Date();
    const dosTime=(now.getHours()<<11)|(now.getMinutes()<<5)|Math.floor(now.getSeconds()/2);
    const dosDate=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
    const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
    const crc32=data=>{let c=0xFFFFFFFF;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
    const u16=n=>new Uint8Array([n&255,(n>>>8)&255]);
    const u32=n=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
    const concat=arr=>{const out=new Uint8Array(arr.reduce((s,a)=>s+a.length,0));let p=0;for(const a of arr){out.set(a,p);p+=a.length;}return out;};
    for(const entry of entries){
      const name=enc.encode(entry.name), data=typeof entry.data==='string'?enc.encode(entry.data):entry.data;
      const crc=crc32(data), size=data.length, flags=0x0800;
      const local=concat([u32(0x04034b50),u16(20),u16(flags),u16(0),u16(dosTime),u16(dosDate),u32(crc),u32(size),u32(size),u16(name.length),u16(0),name]);
      chunks.push(local,data);
      central.push(concat([u32(0x02014b50),u16(20),u16(20),u16(flags),u16(0),u16(dosTime),u16(dosDate),u32(crc),u32(size),u32(size),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));
      offset+=local.length+size;
    }
    const centralBytes=concat(central), centralOffset=offset, centralSize=centralBytes.length;
    const end=concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(centralSize),u32(centralOffset),u16(0)]);
    return concat([...chunks,centralBytes,end]);
  }
  function createXlsxBlob(sheets) {
    const workbookSheets=sheets.map((s,i)=>`<sheet name="${xlsxXmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
    const rels=sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');
    const contentSheets=sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const entries=[
      {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentSheets}</Types>`},
      {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
      {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`},
      {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
      {name:'xl/styles.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`}
    ];
    sheets.forEach((s,i)=>entries.push({name:`xl/worksheets/sheet${i+1}.xml`,data:xlsxWorksheetXml(s.rows)}));
    return new Blob([xlsxZipBytes(entries)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function xlsxDownload(blob,fileName){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function buildOrderAnalysisXlsxRows(){
    const output=[['채널','위치','방향','오더','RPM','Curve','1X주파수_Hz','이론오더주파수_Hz','검출피크주파수_Hz','주파수편차_Hz','피크검색하한_Hz','피크검색상한_Hz','피크검색반폭_Hz','합산하한_Hz','합산상한_Hz','합산반폭_Hz','합산포인트수','단일피크진폭','Order합산진폭','표시진폭','표시단위','판정']];
    multiAnalysisRows.forEach(r=>output.push([r.channelId,r.point,r.direction,r.order,r.rpm,r.curveNo,r.rotationFrequency,r.targetFrequency,r.peakFrequency,r.frequencyDeviation,r.searchMin,r.searchMax,r.searchHalfWidth,r.sumMin,r.sumMax,r.sumHalfWidth,r.summedPointCount,r.peakAmplitude,r.orderAmplitude,r.displayAmplitude,r.displayUnit,r.matched?'일치':'불일치']));
    return output;
  }
  function buildRssSumXlsxRows(){
    const output=[['채널','위치','방향','합산 오더','RPM','구성 오더별 진폭','오더별 피크 중심 합산 범위','RSS 합산 내부값','표시진폭','표시단위','구성 오더 유효성']];
    if(!currentReport) return output;
    const sel=getMultiSelection();
    if(!sel || sel.orders.length<2) return output;
    for(const channelId of sel.channelIds){
      const channel=currentReport.normalized.channels[channelId];
      const item=buildRssSumSeries(channel,channelId,sel.orders,sel,MULTI_COLORS[0]);
      if(!item) continue;
      for(const r of item.rows){
        const components=r.componentRows.map(x=>`${x.order}차=${Number.isFinite(x.row.displayAmplitude)?formatSig4(x.row.displayAmplitude):'-'} ${r.displayUnit}`).join(' | ');
        const ranges=r.componentRows.map(x=>`${x.order}차: ${formatFrequency2(x.row.sumMin)}~${formatFrequency2(x.row.sumMax)} Hz`).join(' | ');
        output.push([channelId,channel.point,channel.direction,sel.orders.join(' + '),r.rpm,components,ranges,r.orderAmplitude,r.displayAmplitude,r.displayUnit,r.matched?'모두 일치':'일부 불일치']);
      }
    }
    return output;
  }

  function buildXlsxSettingsRows(){
    const settings=[['항목','값'],['Analyzer Version',ANALYZER_VERSION],['원본 CSV',currentReport?.fileName||'-'],['저장 시각',new Date().toLocaleString('ko-KR')],['테마',isDarkMode()?'Dark':'Light'],['Order Analysis 채널', $('orderChannelSelect')?.value||'-'],['Order', $('orderInput')?.value||'-'],['Peak Search Range (±Hz)',Number($('peakSearchInput')?.value)],['Sum Width (±Hz)',Number($('sumWidthInput')?.value)],['Match Tolerance (Hz)',Number($('matchToleranceInput')?.value)],['Multi Order', $('multiOrderInput')?.value||'-'],['Multi Search Width (±Hz)',Number($('multiSearchWidth')?.value)],['Multi Sum Width (±Hz)',Number($('multiSumWidth')?.value)],['Overall 그래프 표시',$('showOverall')?.checked?'표시':'숨김'],['RSS 합산 그래프 표시',$('showRssSum')?.checked?'표시':'숨김'],['차수별 기여도 분석 채널',$('contributionChannelSelect')?.value||'-'],['Spectrum Map 가로축 기준',mapXAxisMode==='order'?'Order':'Frequency'],['Noise 표시 단위', $('noiseAmplitudeMode')?.value||'-'],['Noise Source dB 기준값',Number($('noiseSourceDbReference')?.value)],['Noise Order dB 기준값',Number($('noiseOrderDbReference')?.value)],['Vibration 표시 단위', $('vibrationAmplitudeMode')?.value||'-'],['Vibration Source dB 기준값',Number($('vibrationSourceDbReference')?.value)],['Vibration Order dB 기준값',Number($('vibrationOrderDbReference')?.value)]];
    return settings;
  }
  function downloadOrderAnalysisXlsx(){
    if(!currentReport || !multiAnalysisRows.length){
      setStatus('XLSX로 저장할 Order Analysis 데이터가 없습니다.','warning'); return;
    }
    const sheets=[{name:'Settings',rows:buildXlsxSettingsRows()},{name:'Order Analysis',rows:buildOrderAnalysisXlsxRows()}];
    const rss=buildRssSumXlsxRows(); if(rss.length>1)sheets.push({name:'Order RSS Sum',rows:rss});
    const contribution=buildContributionXlsxRows(); if(contribution.length>1)sheets.push({name:'Order Contribution',rows:contribution});
    const blob=createXlsxBlob(sheets);
    const base=(currentReport.fileName||'OrderAnalysis').replace(/\.csv$/i,'');
    xlsxDownload(blob,`${base}_order_analysis_${ANALYZER_VERSION}.xlsx`);
    setStatus(`Order Analysis XLSX를 저장했습니다. (${multiAnalysisRows.length}행)`,'success');
  }

  function formatFixed(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '-';
  }
  function formatSigned(value, digits) {
    if (!Number.isFinite(value)) return '-';
    if (Math.abs(value) < 0.5 * Math.pow(10, -digits)) return Number(0).toFixed(digits);
    return (value > 0 ? '+' : '') + value.toFixed(digits);
  }
  function formatScientific(value) {
    if (!Number.isFinite(value)) return '-';
    return Math.abs(value) !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 10000)
      ? value.toExponential(6)
      : value.toLocaleString('ko-KR', {maximumFractionDigits:9});
  }

  function getMeta(map, candidates) {
    for (const key of candidates) {
      const value = map.get(normalizeMetaKey(key));
      if (value !== undefined && value !== '') return value;
    }
    return '';
  }
  function normalizeMetaKey(value) { return String(value ?? '').trim().replace(/\\{2,}/g, '\\').toLowerCase(); }
  function isFiniteNumber(value) { return Number.isFinite(toNumber(value)); }
  function toNumber(value) {
    const text = String(value ?? '').trim().replace(/,/g, '');
    if (text === '') return NaN;
    const n = Number(text);
    return Number.isFinite(n) ? n : NaN;
  }
  function median(values) {
    const a = values.filter(Number.isFinite).slice().sort((x,y) => x-y);
    if (!a.length) return NaN;
    const m = Math.floor(a.length/2);
    return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
  }
  function mode(values) {
    if (!values.length) return null;
    const counts = new Map();
    for (const v of values) counts.set(String(v), (counts.get(String(v)) || 0) + 1);
    let best = values[0], bestCount = -1;
    for (const v of values) {
      const count = counts.get(String(v));
      if (count > bestCount) { best = v; bestCount = count; }
    }
    return best;
  }
  function uniqueSorted(values) {
    return [...new Set(values)].sort((a,b) => typeof a === 'number' && typeof b === 'number' ? a-b : String(a).localeCompare(String(b)));
  }
  function arraysEqual(a,b) { return a.length === b.length && a.every((v,i) => v === b[i]); }
  function nearlyEqual(a,b,tol=1e-7) { return Number.isFinite(a) && Math.abs(a-b) <= tol; }
  function round(v,d) { if (!Number.isFinite(v)) return NaN; const p=10**d; return Math.round(v*p)/p; }
  function addCheck(list, ok, text, detail) { list.push({ ok, text, detail }); }
  function formatNumber(v) { return Number.isFinite(Number(v)) ? Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 9 }) : '-'; }
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024**2) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024**2).toFixed(2) + ' MB';
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }
})();