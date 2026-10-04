/*!
 * 모듈명   : SalimCalc.carCost
 * 용도     : 자동차 1년 유지비(자동차세·연료비·보험료·정비비·주차/통행료) 계산기
 * 기준     : 지방세법 제127조(비영업용 승용차 cc당 세액, 차령 경감),
 *            지방세법 제151조(지방교육세 30%), 자동차세 연납 공제율 5%(지방세법 시행령, 2025.1.1 시행·2026년 동일),
 *            유가: 한국석유공사 오피넷 2026년 9월 5주(9.27~10.1) 전국 평균
 * 기준일   : 2026-10-05
 * 버전     : 1.0.0
 * 최종수정 : 2026-10-05
 * 저장소   : https://github.com/salimcalc/tools  (calc/car-cost.js)
 */
(function (window, document) {
  'use strict';

  window.SalimCalc = window.SalimCalc || {};

  /* ===== 기준값: 법령·요금이 바뀌면 여기만 수정 ===== */
  var CONFIG = {
    taxYear: 2026,
    baseDate: '2026-10-05',
    // 비영업용 승용차 cc당 세액 (지방세법 제127조)
    ccRates: [
      { maxCc: 1000, rate: 80 },
      { maxCc: 1600, rate: 140 },
      { maxCc: Infinity, rate: 200 }
    ],
    evFlatTax: 100000,          // 전기·수소차(그 밖의 승용차) 연 세액
    eduTaxRate: 0.3,            // 지방교육세 = 자동차세의 30%
    ageReduction: { startAge: 3, perYear: 0.05, max: 0.5 }, // 3년차부터 연 5%, 최대 50%
    // 연납 실제 공제율(연 세액 대비, 신청 월별 근사치. 법정 공제율 5% × 잔여기간 비율)
    prepay: {
      none: { label: '연납 안 함', rate: 0 },
      jan: { label: '1월 연납', rate: 0.0458 },
      mar: { label: '3월 연납', rate: 0.0376 },
      jun: { label: '6월 연납', rate: 0.0251 },
      sep: { label: '9월 연납', rate: 0.0125 }
    },
    // 연료별 기본 단가 (원/L, 원/kWh). null이면 사용자가 직접 입력
    fuels: {
      gasoline: { label: '휘발유', unit: 'L', effUnit: 'km/L', price: 1858, ev: false },
      diesel: { label: '경유', unit: 'L', effUnit: 'km/L', price: 1843, ev: false },
      lpg: { label: 'LPG', unit: 'L', effUnit: 'km/L', price: null, ev: false },
      hybrid: { label: '하이브리드(휘발유)', unit: 'L', effUnit: 'km/L', price: 1858, ev: false },
      electric: { label: '전기', unit: 'kWh', effUnit: 'km/kWh', price: null, ev: true }
    },
    limits: {
      cc: [50, 8000],
      regYear: [1980, 2026],
      km: [0, 200000],
      eff: [0.5, 40],
      price: [1, 5000],
      money: [0, 100000000]
    }
  };

  /* ===== 유틸 ===== */
  function floor10(n) { return Math.floor(n / 10) * 10; }
  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).replace(/,/g, '').trim();
    if (s === '') return NaN;
    return Number(s);
  }
  function fmt(n) {
    var r = Math.round(n);
    return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function ccRate(cc) {
    for (var i = 0; i < CONFIG.ccRates.length; i++) {
      if (cc <= CONFIG.ccRates[i].maxCc) return CONFIG.ccRates[i].rate;
    }
    return CONFIG.ccRates[CONFIG.ccRates.length - 1].rate;
  }
  function carAge(regYear, taxYear) { return taxYear - regYear + 1; }
  function reductionRate(age) {
    var a = CONFIG.ageReduction;
    if (age < a.startAge) return 0;
    return Math.min(Math.round((age - a.startAge + 1) * a.perYear * 100) / 100, a.max);
  }

  /* ===== 순수 계산 함수 ===== */
  function calcTax(input) {
    var fuel = CONFIG.fuels[input.fuel] || CONFIG.fuels.gasoline;
    var age = carAge(input.regYear, CONFIG.taxYear);
    var base, rate = 0, red = 0, note;
    if (fuel.ev) {
      base = CONFIG.evFlatTax;
      note = '전기차 정액 ' + fmt(base) + '원(차령 경감 없음)';
    } else {
      rate = ccRate(input.cc);
      red = reductionRate(age);
      base = input.cc * rate;
      note = fmt(input.cc) + 'cc × ' + rate + '원' + (red > 0 ? ' × (1 − 차령 경감 ' + Math.round(red * 100) + '%)' : '');
    }
    var carTax = floor10(base * (1 - red));
    var eduTax = floor10(carTax * CONFIG.eduTaxRate);
    var pre = CONFIG.prepay[input.prepay] || CONFIG.prepay.none;
    var gross = carTax + eduTax;
    var discount = floor10(gross * pre.rate);
    return {
      age: age, ccRate: rate, reduction: red,
      carTax: carTax, eduTax: eduTax, prepayDiscount: discount,
      total: gross - discount, note: note, prepayLabel: pre.label
    };
  }

  function calculate(input) {
    var fuel = CONFIG.fuels[input.fuel] || CONFIG.fuels.gasoline;
    var tax = calcTax(input);
    var fuelQty = input.efficiency > 0 ? input.annualKm / input.efficiency : 0;
    var fuelCost = Math.round(fuelQty * input.fuelPrice);
    var parking = Math.round(input.monthlyParking * 12);
    var items = [
      { key: 'tax', label: '자동차세(지방교육세 포함)', amount: tax.total },
      { key: 'fuel', label: (fuel.ev ? '충전비' : '연료비'), amount: fuelCost },
      { key: 'insurance', label: '자동차보험료', amount: Math.round(input.insurance) },
      { key: 'maintenance', label: '정비·소모품', amount: Math.round(input.maintenance) },
      { key: 'parking', label: '주차비·통행료', amount: parking },
      { key: 'etc', label: '기타(세차·검사 등)', amount: Math.round(input.etc) }
    ];
    var total = 0;
    for (var i = 0; i < items.length; i++) total += items[i].amount;
    return {
      items: items,
      tax: tax,
      fuelQty: fuelQty,
      fuelUnit: fuel.unit,
      total: total,
      monthly: Math.round(total / 12),
      perKm: input.annualKm > 0 ? Math.round(total / input.annualKm) : 0
    };
  }

  function validate(raw) {
    var L = CONFIG.limits, err = [];
    var fuel = CONFIG.fuels[raw.fuel] ? raw.fuel : 'gasoline';
    var f = CONFIG.fuels[fuel];
    var v = {
      fuel: fuel,
      prepay: CONFIG.prepay[raw.prepay] ? raw.prepay : 'none',
      cc: toNum(raw.cc),
      regYear: toNum(raw.regYear),
      annualKm: toNum(raw.annualKm),
      efficiency: toNum(raw.efficiency),
      fuelPrice: toNum(raw.fuelPrice),
      insurance: toNum(raw.insurance),
      maintenance: toNum(raw.maintenance),
      monthlyParking: toNum(raw.monthlyParking),
      etc: toNum(raw.etc)
    };
    function chk(key, range, msg, optional) {
      if (isNaN(v[key])) { if (optional) { v[key] = 0; return; } err.push(msg + ' 값을 입력해 주세요.'); return; }
      if (v[key] < range[0] || v[key] > range[1]) err.push(msg + ' 값은 ' + fmt(range[0]) + '~' + fmt(range[1]) + ' 사이로 입력해 주세요.');
    }
    if (!f.ev) chk('cc', L.cc, '배기량(cc)'); else v.cc = 0;
    chk('regYear', L.regYear, '최초 등록연도');
    chk('annualKm', L.km, '연간 주행거리');
    chk('efficiency', L.eff, '연비');
    chk('fuelPrice', L.price, (f.ev ? '충전 단가' : '연료 단가'));
    chk('insurance', L.money, '보험료', true);
    chk('maintenance', L.money, '정비·소모품비', true);
    chk('monthlyParking', L.money, '월 주차·통행료', true);
    chk('etc', L.money, '기타 비용', true);
    return { ok: err.length === 0, errors: err, value: v };
  }

  /* ===== DOM ===== */
  function q(root, name) { return root.querySelector('[data-f="' + name + '"]'); }

  function bindComma(el) {
    el.addEventListener('input', function () {
      var raw = el.value.replace(/[^\d]/g, '');
      el.value = raw === '' ? '' : fmt(Number(raw));
    });
  }

  function syncFuel(root) {
    var key = q(root, 'fuel').value;
    var f = CONFIG.fuels[key];
    var ccRow = root.querySelector('[data-row="cc"]');
    if (ccRow) ccRow.style.display = f.ev ? 'none' : '';
    var effUnit = root.querySelector('[data-unit="eff"]');
    var priceUnit = root.querySelector('[data-unit="price"]');
    if (effUnit) effUnit.textContent = f.effUnit;
    if (priceUnit) priceUnit.textContent = '원/' + f.unit;
    var price = q(root, 'fuelPrice');
    var hint = root.querySelector('[data-hint="price"]');
    if (f.price) {
      price.value = fmt(f.price);
      if (hint) hint.textContent = '오피넷 ' + '2026년 9월 5주 전국 평균 ' + f.label + ' 가격입니다. 내 동네 가격으로 바꿔도 됩니다.';
    } else {
      price.value = '';
      if (hint) hint.textContent = (f.ev ? '자주 쓰는 충전기의 kWh당 요금' : '최근 주유한 LPG 리터당 가격') + '을 직접 입력해 주세요.';
    }
  }

  function render(out, res) {
    var rows = '';
    for (var i = 0; i < res.items.length; i++) {
      var it = res.items[i];
      rows += '<tr><th scope="row">' + it.label + '</th><td>' + fmt(it.amount) + '원</td></tr>';
    }
    var t = res.tax;
    var taxDetail = '자동차세 ' + fmt(t.carTax) + '원 + 지방교육세 ' + fmt(t.eduTax) + '원' +
      (t.prepayDiscount > 0 ? ' − ' + t.prepayLabel + ' 공제 약 ' + fmt(t.prepayDiscount) + '원' : '');
    out.innerHTML =
      '<div class="salim-cc-total"><span>1년 예상 유지비</span><strong>' + fmt(res.total) + '원</strong>' +
      '<em>월 평균 ' + fmt(res.monthly) + '원 · 1km당 ' + fmt(res.perKm) + '원</em></div>' +
      '<table class="salim-cc-table"><tbody>' + rows + '</tbody></table>' +
      '<p class="salim-cc-basis">계산 근거: 자동차세 = ' + t.note + ' (차령 ' + t.age + '년차) → ' + taxDetail +
      ' / 연료비 = 연 주행거리 ÷ 연비 × 단가 (약 ' + fmt(res.fuelQty) + res.fuelUnit + ')</p>' +
      '<p class="salim-cc-note">참고용 추정치이며 실제 세액은 위택스·지자체 고지서, 보험료는 보험사 견적 기준입니다.</p>';
    out.style.display = '';
  }

  function renderErrors(out, errors) {
    var li = '';
    for (var i = 0; i < errors.length; i++) li += '<li>' + errors[i] + '</li>';
    out.innerHTML = '<ul class="salim-cc-error">' + li + '</ul>';
    out.style.display = '';
  }

  function init(selector) {
    var root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!root) return;
    var fallback = root.querySelector('.salim-cc-fallback');
    if (fallback) fallback.style.display = 'none';
    var form = root.querySelector('.salim-cc-form');
    if (form) form.style.display = '';
    var out = root.querySelector('.salim-cc-result');
    var commaEls = root.querySelectorAll('[data-comma]');
    for (var i = 0; i < commaEls.length; i++) bindComma(commaEls[i]);

    var fuelSel = q(root, 'fuel');
    fuelSel.addEventListener('change', function () { syncFuel(root); });
    syncFuel(root);

    function run() {
      var names = ['fuel', 'prepay', 'cc', 'regYear', 'annualKm', 'efficiency', 'fuelPrice', 'insurance', 'maintenance', 'monthlyParking', 'etc'];
      var raw = {};
      for (var j = 0; j < names.length; j++) {
        var el = q(root, names[j]);
        raw[names[j]] = el ? el.value : '';
      }
      var r = validate(raw);
      if (!r.ok) { renderErrors(out, r.errors); return; }
      render(out, calculate(r.value));
      if (out.scrollIntoView) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    var btn = root.querySelector('[data-action="calc"]');
    if (btn) btn.addEventListener('click', run);
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    var reset = root.querySelector('[data-action="reset"]');
    if (reset) reset.addEventListener('click', function () {
      setTimeout(function () { syncFuel(root); out.style.display = 'none'; out.innerHTML = ''; }, 0);
    });
  }

  window.SalimCalc.carCost = {
    CONFIG: CONFIG,
    calcTax: calcTax,
    calculate: calculate,
    validate: validate,
    init: init
  };
})(window, document);
