# 자동차 유지비 계산기 콘텐츠 (세션 cse_01LvmHMSpKrzGJdH8w4hG2He 최종 응답)

유형은 **B. 생활 밀착형 계산기 글**로 정했습니다. 기준값은 먼저 검색해 확인했습니다. 계산기는 브라우저에서 돌려 봤고, 예시 2건의 계산값, 모바일 375px 화면 렌더링, 스크립트 로드 실패 시 대체 문구 표시까지 확인했습니다.

**확인한 기준값 (2026-10-05 기준)**

- **자동차세(비영업용 승용차):** 1,000cc 이하는 cc당 80원, 1,600cc 이하는 140원, 1,600cc 초과는 200원입니다. 전기차는 연 10만 원 정액이고, 모든 차에 지방교육세 30%가 붙습니다.
- **차령 경감:** 3년차부터 매년 5%씩 줄고 최대 50%까지 경감됩니다. 전기차에는 적용되지 않습니다.
- **연납 공제율:** 5%이며 2025.1.1부터 시행됐고 2026년에도 같습니다. 신청 월별 실제 공제율은 1월 약 4.58%, 3월 3.76%, 6월 2.51%, 9월 1.25%입니다.
- **유가:** 오피넷 2026년 9월 5주(9.27~10.1) 전국 평균으로 휘발유 1,857.6원, 경유 1,843.3원입니다.
- **LPG·전기 충전 단가:** 확인된 최신 평균값이 없어 기본값을 넣지 않았습니다. 독자가 직접 입력하는 방식입니다.

**키워드**

- 핵심: 자동차 유지비 계산
- 롱테일: 자동차세 계산 2026 / 1년 자동차 유지비 / 경차 유지비 / 자동차세 연납 할인 / 월 차량 유지비

---

## 산출물 1) `calc/car-cost.js`

```javascript
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
```

---

## 산출물 2) 블로그 본문 HTML

설명 본문은 공백 제외 약 2,840자입니다. 첫 문단 134자 안에 핵심 키워드와 이 글로 알 수 있는 내용을 넣었습니다.

스크립트가 어떻게 동작하는지는 다음과 같습니다.

- **대체 문구:** 계산기 입력폼은 기본적으로 숨겨져 있고, JS가 정상 로드되면 그때 폼이 보이고 대체 문구가 사라집니다. 그래서 로드에 실패하면 "계산기를 불러오지 못했습니다" 문구가 그대로 남습니다.
- **인라인 스크립트:** Blogger 편집기가 `&&`를 `&amp;&amp;`로 바꿔 버리는 경우가 있어서, `&&` 대신 if문을 겹쳐 썼습니다.

```html
<style>
.salim-post{font-size:17px;line-height:1.75;color:#222;word-break:keep-all;overflow-wrap:break-word}
.salim-post h2{font-size:1.35em;margin:2.2em 0 .8em;padding:.4em 0 .4em .7em;border-left:5px solid #2f7d5b;background:#f3f8f5;line-height:1.4}
.salim-post h3{font-size:1.15em;margin:1.6em 0 .6em;color:#2f7d5b}
.salim-post p{margin:0 0 1em}
.salim-post .salim-lead{background:#fffbea;border:1px solid #f0e2a8;border-radius:10px;padding:14px 16px}
.salim-post .salim-toc{background:#f7f7f7;border-radius:10px;padding:14px 18px;margin:1.2em 0}
.salim-post .salim-toc strong{display:block;margin-bottom:6px}
.salim-post .salim-toc ol{margin:0;padding-left:1.3em}
.salim-post .salim-toc a{color:#2f7d5b;text-decoration:none;display:inline-block;min-height:32px;line-height:32px}
.salim-post table{width:100%;border-collapse:collapse;margin:0 0 1.2em;font-size:16px}
.salim-post th,.salim-post td{border:1px solid #ddd;padding:10px 8px;text-align:left;vertical-align:top}
.salim-post thead th{background:#eef5f1}
.salim-post .salim-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.salim-post ul.salim-check{list-style:none;padding-left:0}
.salim-post ul.salim-check li{padding-left:1.6em;position:relative;margin-bottom:.5em}
.salim-post ul.salim-check li:before{content:"✔";position:absolute;left:0;color:#2f7d5b}
.salim-post .salim-case{border:1px solid #e3e3e3;border-radius:10px;padding:14px 16px;margin-bottom:1em}
.salim-post .salim-notice{font-size:15px;color:#666;background:#f7f7f7;border-radius:8px;padding:12px 14px}
.salim-post .salim-faq dt{font-weight:700;margin-top:1.2em}
.salim-post .salim-faq dd{margin:.4em 0 0}
/* 계산기 */
.salim-post .salim-calc{border:2px solid #2f7d5b;border-radius:14px;padding:16px;background:#fbfdfc;margin:1.2em 0}
.salim-post .salim-cc-fallback{color:#b00020;font-weight:700;margin:0}
.salim-post .salim-cc-field{margin-bottom:14px}
.salim-post .salim-cc-field label{display:block;font-weight:700;margin-bottom:4px;font-size:16px}
.salim-post .salim-cc-input{display:flex;align-items:center;gap:6px}
.salim-post .salim-cc-input input,.salim-post .salim-cc-input select{flex:1;min-width:0;min-height:44px;font-size:16px;padding:8px 10px;border:1px solid #bbb;border-radius:8px;background:#fff;box-sizing:border-box}
.salim-post .salim-cc-input span{white-space:nowrap;color:#555;font-size:15px}
.salim-post .salim-cc-hint{display:block;font-size:14px;color:#777;margin-top:3px}
.salim-post .salim-cc-btns{display:flex;gap:8px;margin-top:6px}
.salim-post .salim-cc-btns button{min-height:48px;font-size:17px;border-radius:10px;border:0;cursor:pointer;padding:0 16px}
.salim-post .salim-cc-btns .salim-cc-go{flex:1;background:#2f7d5b;color:#fff;font-weight:700}
.salim-post .salim-cc-btns .salim-cc-reset{background:#e6e6e6;color:#333}
.salim-post .salim-cc-result{margin-top:16px}
.salim-post .salim-cc-total{background:#2f7d5b;color:#fff;border-radius:12px;padding:16px;text-align:center;margin-bottom:12px}
.salim-post .salim-cc-total span{display:block;font-size:15px;opacity:.9}
.salim-post .salim-cc-total strong{display:block;font-size:1.8em;line-height:1.3}
.salim-post .salim-cc-total em{display:block;font-style:normal;font-size:15px;opacity:.95}
.salim-post .salim-cc-table td{text-align:right;white-space:nowrap}
.salim-post .salim-cc-basis{font-size:14px;color:#555}
.salim-post .salim-cc-note{font-size:14px;color:#888}
.salim-post .salim-cc-error{color:#b00020;padding-left:1.2em;margin:0}
@media (min-width:640px){.salim-post .salim-cc-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}}
</style>

<div class="salim-post">

<p class="salim-lead"><strong>자동차 유지비 계산</strong>은 자동차세·기름값·보험료·정비비를 한 번에 더해 봐야 정확합니다. 이 글을 읽으면 2026년 기준 자동차세 계산법과 차령 경감·연납 할인, 그리고 내 차의 1년·월 유지비를 계산기로 바로 확인하는 방법을 알 수 있습니다.</p>

<nav class="salim-toc" aria-label="목차">
<strong>📋 목차</strong>
<ol>
<li><a href="#cost-items">자동차 유지비, 어떤 항목이 들어가나요</a></li>
<li><a href="#car-tax">2026년 자동차세 계산 방법</a></li>
<li><a href="#calculator">자동차 유지비 계산기</a></li>
<li><a href="#examples">실제 사례로 본 1년 유지비</a></li>
<li><a href="#save-tips">유지비 줄이는 체크리스트</a></li>
<li><a href="#faq">자주 묻는 질문</a></li>
</ol>
</nav>

<h2 id="cost-items">자동차 유지비, 어떤 항목이 들어가나요</h2>
<p>차를 사고 나면 할부금 말고도 매달, 매년 나가는 돈이 꽤 됩니다. 보통 "기름값만 생각했다가 연말에 깜짝 놀랐다"는 이야기가 나오는 이유도 고정비가 따로 있기 때문입니다.</p>
<p>자동차 유지비는 크게 <strong>고정비</strong>와 <strong>변동비</strong>로 나눠 보면 이해가 쉽습니다. 고정비는 차를 세워만 둬도 나가는 돈이고, 변동비는 많이 탈수록 늘어나는 돈입니다.</p>
<div class="salim-table-wrap">
<table>
<thead><tr><th>구분</th><th>항목</th><th>특징</th></tr></thead>
<tbody>
<tr><td rowspan="2">고정비</td><td>자동차세</td><td>배기량·차령으로 결정, 6월·12월 두 번 고지</td></tr>
<tr><td>자동차보험료</td><td>나이·경력·차종·특약에 따라 차이가 큼</td></tr>
<tr><td rowspan="3">변동비</td><td>연료비(충전비)</td><td>주행거리 ÷ 연비 × 단가</td></tr>
<tr><td>정비·소모품</td><td>엔진오일, 타이어, 브레이크 패드 등</td></tr>
<tr><td>주차비·통행료</td><td>출퇴근 경로와 거주지에 따라 차이가 큼</td></tr>
</tbody>
</table>
</div>
<p>이 가운데 <strong>자동차세와 연료비</strong>는 공식과 공개된 단가가 있어서 미리 꽤 정확하게 계산할 수 있습니다. 보험료와 정비비는 사람마다 달라서 작년 영수증이나 갱신 안내문 금액을 넣는 것이 가장 정확합니다.</p>

<h2 id="car-tax">2026년 자동차세 계산 방법</h2>
<p>자동차세는 지방세라서 주소지 시·군·구에서 고지합니다. 일반 승용차(비영업용)는 <strong>배기량(cc) × cc당 세액</strong>으로 먼저 금액을 구하고, 여기에 <strong>지방교육세 30%</strong>가 더해집니다.</p>
<div class="salim-table-wrap">
<table>
<thead><tr><th>배기량</th><th>cc당 세액</th><th>예시(교육세 포함, 신차 기준)</th></tr></thead>
<tbody>
<tr><td>1,000cc 이하</td><td>80원</td><td>998cc → 약 10만 4천 원</td></tr>
<tr><td>1,600cc 이하</td><td>140원</td><td>1,598cc → 약 29만 원</td></tr>
<tr><td>1,600cc 초과</td><td>200원</td><td>1,999cc → 약 52만 원</td></tr>
<tr><td>전기·수소차</td><td>정액 10만 원</td><td>교육세 포함 13만 원</td></tr>
</tbody>
</table>
</div>
<p>하이브리드차는 엔진 배기량 기준으로 일반 승용차와 같은 방식으로 계산합니다. 전기차는 배기량이 없어서 정액으로 냅니다.</p>

<h3 id="car-age">차령 경감: 오래 탈수록 세금이 줄어듭니다</h3>
<p>비영업용 승용차는 <strong>차령 3년차부터 매년 5%씩</strong> 자동차세가 줄어들고, 12년차 이상은 <strong>최대 50%</strong>까지 경감됩니다. 차령은 간단히 "올해 연도 − 최초 등록연도 + 1"로 셈하면 됩니다. 다만 전기차 정액세에는 차령 경감이 없습니다.</p>
<ul class="salim-check">
<li>2024년 등록 → 2026년은 3년차, 5% 경감</li>
<li>2019년 등록 → 2026년은 8년차, 30% 경감</li>
<li>2015년 이전 등록 → 12년차 이상, 50% 경감</li>
</ul>

<h3 id="prepay">연납 할인: 한 번에 내면 조금 덜 냅니다</h3>
<p>자동차세를 1년 치 미리 내는 연납을 신청하면 법정 공제율 <strong>5%</strong>를 남은 기간만큼 나눠 깎아 줍니다. 그래서 일찍 낼수록 할인 폭이 큽니다. 실제 체감 할인율은 1월 약 4.58%, 3월 약 3.76%, 6월 약 2.51%, 9월 약 1.25% 수준입니다.</p>
<p>연납은 위택스나 서울시 이택스, 지자체 고지서로 신청할 수 있습니다. 세부 기간과 금액은 해마다 고지 기준으로 확인하는 것이 안전합니다.</p>

<h2 id="calculator">자동차 유지비 계산기</h2>
<p>아래에 차량 정보와 작년 지출을 넣으면 <strong>1년 유지비 총액, 월 평균, 1km당 비용</strong>을 보여 줍니다. 모르는 항목은 비워 두면 0원으로 계산합니다.</p>

<div id="salim-car-cost" class="salim-calc">
  <p class="salim-cc-fallback">⚠ 계산기를 불러오지 못했습니다. 새로고침하거나 잠시 후 다시 시도해 주세요.</p>
  <form class="salim-cc-form" style="display:none" autocomplete="off" novalidate>
    <div class="salim-cc-grid">
      <div class="salim-cc-field">
        <label for="scc-fuel">연료 종류</label>
        <div class="salim-cc-input"><select id="scc-fuel" data-f="fuel">
          <option value="gasoline">휘발유</option>
          <option value="diesel">경유</option>
          <option value="hybrid">하이브리드(휘발유)</option>
          <option value="lpg">LPG</option>
          <option value="electric">전기</option>
        </select></div>
      </div>
      <div class="salim-cc-field" data-row="cc">
        <label for="scc-cc">배기량</label>
        <div class="salim-cc-input"><input id="scc-cc" data-f="cc" data-comma type="text" inputmode="numeric" placeholder="예: 1,999"><span>cc</span></div>
        <small class="salim-cc-hint">자동차등록증 '배기량' 칸에 적혀 있습니다.</small>
      </div>
      <div class="salim-cc-field">
        <label for="scc-year">최초 등록연도</label>
        <div class="salim-cc-input"><input id="scc-year" data-f="regYear" type="text" inputmode="numeric" maxlength="4" placeholder="예: 2022"><span>년</span></div>
      </div>
      <div class="salim-cc-field">
        <label for="scc-prepay">자동차세 연납</label>
        <div class="salim-cc-input"><select id="scc-prepay" data-f="prepay">
          <option value="none">연납 안 함</option>
          <option value="jan">1월 연납</option>
          <option value="mar">3월 연납</option>
          <option value="jun">6월 연납</option>
          <option value="sep">9월 연납</option>
        </select></div>
      </div>
      <div class="salim-cc-field">
        <label for="scc-km">연간 주행거리</label>
        <div class="salim-cc-input"><input id="scc-km" data-f="annualKm" data-comma type="text" inputmode="numeric" placeholder="예: 12,000"><span>km</span></div>
      </div>
      <div class="salim-cc-field">
        <label for="scc-eff">실제 연비</label>
        <div class="salim-cc-input"><input id="scc-eff" data-f="efficiency" type="text" inputmode="decimal" placeholder="예: 12.5"><span data-unit="eff">km/L</span></div>
      </div>
      <div class="salim-cc-field">
        <label for="scc-price">연료 단가</label>
        <div class="salim-cc-input"><input id="scc-price" data-f="fuelPrice" data-comma type="text" inputmode="numeric"><span data-unit="price">원/L</span></div>
        <small class="salim-cc-hint" data-hint="price"></small>
      </div>
      <div class="salim-cc-field">
        <label for="scc-ins">연간 자동차보험료</label>
        <div class="salim-cc-input"><input id="scc-ins" data-f="insurance" data-comma type="text" inputmode="numeric" placeholder="예: 900,000"><span>원</span></div>
      </div>
      <div class="salim-cc-field">
        <label for="scc-mnt">연간 정비·소모품비</label>
        <div class="salim-cc-input"><input id="scc-mnt" data-f="maintenance" data-comma type="text" inputmode="numeric" placeholder="예: 400,000"><span>원</span></div>
      </div>
      <div class="salim-cc-field">
        <label for="scc-park">월 주차비·통행료</label>
        <div class="salim-cc-input"><input id="scc-park" data-f="monthlyParking" data-comma type="text" inputmode="numeric" placeholder="예: 50,000"><span>원/월</span></div>
      </div>
      <div class="salim-cc-field">
        <label for="scc-etc">기타 연간 비용(세차·검사 등)</label>
        <div class="salim-cc-input"><input id="scc-etc" data-f="etc" data-comma type="text" inputmode="numeric" placeholder="예: 100,000"><span>원</span></div>
      </div>
    </div>
    <div class="salim-cc-btns">
      <button type="button" class="salim-cc-go" data-action="calc">🚗 유지비 계산하기</button>
      <button type="reset" class="salim-cc-reset" data-action="reset">초기화</button>
    </div>
    <div class="salim-cc-result" aria-live="polite" style="display:none"></div>
  </form>
</div>

<h2 id="examples">실제 사례로 본 1년 유지비</h2>
<p>숫자를 넣어 보면 어떤 항목이 가장 큰지 바로 보입니다. 아래 두 사례는 계산기에 그대로 넣어서 나온 값입니다.</p>

<div class="salim-case">
<h3 id="case-1">사례 1. 2024년식 2,000cc 중형 세단, 출퇴근용</h3>
<p>배기량 1,999cc, 2024년 등록(2026년 3년차), 1년에 12,000km를 타고 실제 연비는 12km/L입니다. 휘발유는 1,858원, 보험료 90만 원, 정비비 40만 원, 회사 주차비와 통행료로 매달 5만 원이 나갑니다.</p>
<ul class="salim-check">
<li>자동차세: 1,999cc × 200원 × 95% = 379,810원 + 교육세 113,940원 = <strong>493,750원</strong></li>
<li>연료비: 12,000km ÷ 12km/L × 1,858원 = <strong>1,858,000원</strong></li>
<li>보험료 900,000원 + 정비비 400,000원 + 주차·통행료 600,000원</li>
</ul>
<p>합계는 <strong>연 4,251,750원, 월 약 35만 4천 원</strong>입니다. 1km를 달릴 때마다 약 354원이 드는 셈이고, 연료비가 전체의 40%를 넘습니다.</p>
</div>

<div class="salim-case">
<h3 id="case-2">사례 2. 2019년식 경차, 장보기·주말용</h3>
<p>배기량 998cc, 2019년 등록(2026년 8년차), 1년에 8,000km를 타고 연비는 14km/L입니다. 1월에 연납을 했고, 보험료 60만 원, 정비비 30만 원, 세차·검사 등 기타 10만 원이 들었습니다.</p>
<ul class="salim-check">
<li>자동차세: 998cc × 80원 × 70% = 55,880원 + 교육세 16,760원 − 1월 연납 공제 3,320원 = <strong>69,320원</strong></li>
<li>연료비: 8,000km ÷ 14km/L × 1,858원 = 약 <strong>1,061,714원</strong></li>
</ul>
<p>합계는 <strong>연 2,131,034원, 월 약 17만 8천 원</strong>입니다. 경차는 cc당 세액이 낮고 차령 경감까지 받아 자동차세 부담이 사례 1의 7분의 1 수준입니다.</p>
</div>

<h2 id="save-tips">유지비 줄이는 체크리스트</h2>
<p>유지비는 한 번에 크게 줄이기보다 새는 돈을 막는 쪽이 효과적입니다. 아래 항목을 하나씩 확인해 보세요.</p>
<ul class="salim-check">
<li><strong>자동차세는 1월 연납</strong>: 같은 세금도 1월에 내면 할인 폭이 가장 큽니다.</li>
<li><strong>보험은 갱신 전 비교</strong>: 마일리지 특약, 블랙박스 특약, 운전자 범위 한정을 점검합니다.</li>
<li><strong>주유는 가격 비교 후</strong>: 오피넷에서 내 주변 최저가 주유소를 확인합니다.</li>
<li><strong>타이어 공기압 월 1회 점검</strong>: 공기압이 낮으면 연비가 떨어집니다.</li>
<li><strong>소모품 교체 주기 기록</strong>: 엔진오일·필터를 제때 바꾸면 큰 수리를 줄일 수 있습니다.</li>
<li><strong>급가속·공회전 줄이기</strong>: 같은 거리라도 운전 습관에 따라 연료비 차이가 납니다.</li>
</ul>
<!-- 내부링크 제안: 자동차세 연납 신청 방법(위택스·이택스) 단계별 안내 글 -->
<p>자동차세 연납을 처음 신청한다면 <a href="[내부링크-자동차세-연납-신청방법]">자동차세 연납 신청 방법</a> 글을 함께 보시면 편합니다.</p>
<!-- 내부링크 제안: 자동차보험 마일리지 특약 환급 계산기 글 -->
<p>보험료를 줄이고 싶다면 <a href="[내부링크-자동차보험-마일리지-특약]">자동차보험 마일리지 특약 환급 계산</a>도 확인해 보세요.</p>
<!-- 내부링크 제안: 전기차 vs 휘발유차 연료비 비교 계산기 글 -->
<p>차를 바꿀 계획이라면 <a href="[내부링크-전기차-휘발유차-비교]">전기차와 휘발유차 연료비 비교</a>가 도움이 됩니다.</p>

<h2 id="faq">자주 묻는 질문</h2>
<dl class="salim-faq">
<dt>Q1. 자동차세는 언제, 몇 번 내나요?</dt>
<dd>1년 세액을 반으로 나눠 6월과 12월에 고지됩니다. 1월(또는 3·6·9월)에 연납을 신청하면 1년 치를 한 번에 내고 일부를 공제받을 수 있습니다.</dd>
<dt>Q2. 중고차를 샀는데 차령은 언제부터 세나요?</dt>
<dd>차령은 내가 산 시점이 아니라 그 차가 처음 등록된 연도부터 셉니다. 자동차등록증의 최초 등록일을 확인하면 됩니다.</dd>
<dt>Q3. 하이브리드차 자동차세는 얼마인가요?</dt>
<dd>하이브리드차는 엔진 배기량 기준으로 일반 승용차와 같은 cc당 세액을 적용합니다. 1,598cc 하이브리드 신차라면 교육세 포함 약 29만 원입니다.</dd>
<dt>Q4. 전기차 자동차세도 오래 타면 줄어드나요?</dt>
<dd>전기차는 연 10만 원(교육세 포함 13만 원) 정액이며, 일반 승용차와 달리 차령 경감이 적용되지 않습니다.</dd>
<dt>Q5. 계산기 결과와 고지서 금액이 다를 수 있나요?</dt>
<dd>네, 다를 수 있습니다. 연중 이전·말소, 지자체별 감면, 원 단위 절사 방식 등에 따라 차이가 생기므로 실제 금액은 위택스나 지자체 고지서를 기준으로 확인해 주세요.</dd>
</dl>

<p class="salim-notice">※ 이 글과 계산기는 참고용이며, 실제 세액은 지자체 고지, 보험료는 보험사 견적 기준입니다. 근거: <a href="https://www.law.go.kr/법령/지방세법" rel="nofollow noopener" target="_blank">지방세법(국가법령정보센터)</a> 제127조·제151조, 자동차세 연납 공제율 5%(2025.1.1 시행 지방세법 시행령, 2026년 동일 적용), 유가 <a href="https://www.opinet.co.kr" rel="nofollow noopener" target="_blank">오피넷</a> 2026년 9월 5주(9.27~10.1) 전국 평균 휘발유 1,857.6원·경유 1,843.3원.</p>
<p class="salim-notice">최종 업데이트: 2026-10-05 · 근거 기준일: 2026-10-05</p>

</div>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "자동차세는 언제, 몇 번 내나요?", "acceptedAnswer": {"@type": "Answer", "text": "1년 세액을 반으로 나눠 6월과 12월에 고지됩니다. 1월(또는 3·6·9월)에 연납을 신청하면 1년 치를 한 번에 내고 일부를 공제받을 수 있습니다."}},
    {"@type": "Question", "name": "중고차를 샀는데 차령은 언제부터 세나요?", "acceptedAnswer": {"@type": "Answer", "text": "차령은 내가 산 시점이 아니라 그 차가 처음 등록된 연도부터 셉니다. 자동차등록증의 최초 등록일을 확인하면 됩니다."}},
    {"@type": "Question", "name": "하이브리드차 자동차세는 얼마인가요?", "acceptedAnswer": {"@type": "Answer", "text": "하이브리드차는 엔진 배기량 기준으로 일반 승용차와 같은 cc당 세액을 적용합니다. 1,598cc 하이브리드 신차라면 교육세 포함 약 29만 원입니다."}},
    {"@type": "Question", "name": "전기차 자동차세도 오래 타면 줄어드나요?", "acceptedAnswer": {"@type": "Answer", "text": "전기차는 연 10만 원(교육세 포함 13만 원) 정액이며, 일반 승용차와 달리 차령 경감이 적용되지 않습니다."}},
    {"@type": "Question", "name": "계산기 결과와 고지서 금액이 다를 수 있나요?", "acceptedAnswer": {"@type": "Answer", "text": "네, 다를 수 있습니다. 연중 이전·말소, 지자체별 감면, 원 단위 절사 방식 등에 따라 차이가 생기므로 실제 금액은 위택스나 지자체 고지서를 기준으로 확인해 주세요."}}
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "자동차 유지비 계산 2026 | 자동차세·기름값 한 번에",
  "description": "2026년 자동차세 계산법(cc당 세액·차령 경감·연납 할인)과 연료비·보험료·정비비를 더한 자동차 유지비 계산기.",
  "author": {"@type": "Organization", "name": "살림계산기", "url": "https://salimcalc.blogspot.com/"},
  "publisher": {"@type": "Organization", "name": "살림계산기", "url": "https://salimcalc.blogspot.com/"},
  "datePublished": "2026-10-05",
  "dateModified": "2026-10-05",
  "mainEntityOfPage": "https://salimcalc.blogspot.com/"
}
</script>

<script src="https://cdn.jsdelivr.net/gh/salimcalc/tools@main/calc/car-cost.js"></script>
<script>if (window.SalimCalc) { if (window.SalimCalc.carCost) { SalimCalc.carCost.init('#salim-car-cost'); } }</script>
```

---

## 산출물 3) 발행 체크리스트

```text
[Blogger 설정값]
- 글 제목 : 자동차 유지비 계산 2026 | 자동차세·기름값 한 번에   (32자)
- 검색 설명 : 2026년 자동차세 계산법(cc당 세액·차령 경감·연납 할인)부터 기름값·보험료·정비비까지, 내 차 1년·월 유지비를 계산기로 바로 확인하세요. 실제 사례 2가지와 유지비 줄이는 팁도 정리했습니다.   (110자)
- 라벨 : 자동차유지비, 자동차세, 계산기, 자동차, 생활비절약
- 퍼머링크(맞춤) : car-maintenance-cost-calculator