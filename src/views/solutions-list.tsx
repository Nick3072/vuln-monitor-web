import { Layout } from './layout'
import { raw } from 'hono/html'
import type { AssetWithComponents, MatchedVuln, Solution, ImpactSystem } from '../types'
import type { GroupSummary } from './dashboard'
import { CATEGORY_METADATA, categoryDisplayName, CATEGORY_KEYS } from './category-metadata'
import { IMPACT_SYSTEM_OPTIONS, impactSystemLabel } from './impact-system-metadata'

export interface FlashMessage {
  type: 'success' | 'error'
  message: string
}

// v3.1: 기본 뷰 = 'grouped' (부모 자산 카드). 'list' = 평면 개별 뷰.
export type SolutionsView = 'grouped' | 'list'

// assetOptions: 단건 등록 모달의 "기존 솔루션에 추가" 드롭다운용
interface AssetOption {
  id: number
  name: string
  group_company: string | null
}

export interface SolutionsListProps {
  view: SolutionsView
  // grouped 뷰 데이터 (부모 자산 + 컴포넌트 묶음)
  assets: AssetWithComponents[]
  // list(평면) 뷰 데이터 (기존 솔루션 행)
  solutions: Solution[]
  matchesBySolution: Map<number, MatchedVuln[]>
  // 미연결 구성요소 수 — 0 이면 배너 숨김
  unlinkedCount: number
  // 단건 등록 모달 부모 드롭다운용
  assetOptions: AssetOption[]
  // 그룹/카테고리 필터
  groupSummaries: GroupSummary[]
  activeGroup: string | null
  activeCategory: string | null
  // v3.5 추가 필터 상태
  activeImpact: ImpactSystem | null
  activeMinSeverity: string | null
  activeVulnStatus: string | null
  activeQ: string | null
  flash?: FlashMessage
  // v3.0 — 운영자 세션 컨텍스트
  currentUser?: {
    username: string
    role: 'admin' | 'operator' | 'system'
    groups: string[]
  }
}

// 장비 등록 모달 엔진 옵션 — lib/asset-mapping.ts 매핑 키와 1:1 일치
const DB_ENGINES = ['MySQL', 'MariaDB', 'PostgreSQL', 'Oracle', 'MSSQL', 'MongoDB', 'SQLite', 'Redis', 'Tibero']
const WEB_ENGINES = ['Apache', 'Nginx', 'IIS', 'Tengine', 'Caddy', 'LiteSpeed']
const WAS_ENGINES = ['Tomcat', 'JBoss', 'WildFly', 'WebLogic', 'WebSphere', 'JEUS']

// v3.5 솔루션 목록 활성 필터 상태 (URL 직렬화 단일 소스)
interface SolutionFilters {
  group: string | null
  category: string | null
  impact: ImpactSystem | null
  minSeverity: string | null
  vulnStatus: string | null
  q: string | null
  view: SolutionsView
}

// 활성 필터를 /solutions 쿼리 URL 로 직렬화. overrides 로 특정 키를 교체(null=제거).
function buildSolutionsQuery(
  f: SolutionFilters,
  overrides: Record<string, string | null> = {},
): string {
  const params = new URLSearchParams()
  const set = (k: string, v: string | null) => {
    if (v) params.set(k, v)
  }
  set('group', f.group)
  set('category', f.category)
  set('impact', f.impact)
  set('min_severity', f.minSeverity)
  set('vuln_status', f.vulnStatus)
  set('q', f.q)
  if (f.view === 'list') params.set('view', 'list')
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) params.delete(k)
    else params.set(k, v)
  }
  const s = params.toString()
  return s ? `/solutions?${s}` : '/solutions'
}

export function SolutionsList(props: SolutionsListProps) {
  const isAdmin = props.currentUser?.role === 'admin' || props.currentUser?.role === 'system'
  const scopeLabel = [props.activeGroup, props.activeCategory ? categoryDisplayName(props.activeCategory) : null]
    .filter(Boolean)
    .join(' · ')

  // 총 카운트: grouped 뷰엔 자산 수, list 뷰엔 솔루션 수
  const countLabel =
    props.view === 'grouped'
      ? `자산 ${props.assets.length}건`
      : `솔루션 ${props.solutions.length}건`

  const filters: SolutionFilters = {
    group: props.activeGroup,
    category: props.activeCategory,
    impact: props.activeImpact,
    minSeverity: props.activeMinSeverity,
    vulnStatus: props.activeVulnStatus,
    q: props.activeQ,
    view: props.view,
  }

  return (
    <Layout
      title="솔루션 관리"
      currentPath="/solutions"
      currentUser={props.currentUser}
      activeGroup={props.activeGroup}
    >
      <div class="page-header d-print-none">
        <div class="container-xl">
          <div class="row g-2 align-items-center">
            <div class="col">
              <h2 class="page-title">
                솔루션 관리 {scopeLabel ? `— ${scopeLabel}` : ''}
              </h2>
              <div class="text-muted">등록된 보안솔루션 {countLabel}</div>
            </div>
            <div class="col-auto ms-auto d-print-none">
              <div class="btn-list">
                <ViewToggle filters={filters} />
                <button
                  type="button"
                  class="btn btn-outline-primary d-inline-flex align-items-center"
                  data-bs-toggle="modal"
                  data-bs-target="#bulk-modal"
                >
                  <i class="ti ti-file-upload me-1"></i>CSV 일괄 등록
                </button>
                <button
                  type="button"
                  class="btn btn-success d-inline-flex align-items-center"
                  data-bs-toggle="modal"
                  data-bs-target="#asset-modal"
                  title="장비(서버/방화벽) 1대를 등록합니다. OS 버전 필수, 나머지(HW/DB/OpenSSL/WEB/WAS)는 선택"
                >
                  <i class="ti ti-server-2 me-1"></i>장비 등록
                </button>
                <form method="post" action="/solutions/assets/recompute" class="d-inline">
                  <button
                    type="submit"
                    class="btn btn-outline-secondary d-inline-flex align-items-center"
                    title="구성요소 기반으로 자산 영향시스템을 일괄 재분류합니다 (수동 확정 자산은 보존)"
                  >
                    <i class="ti ti-refresh me-1"></i>영향시스템 재분류
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="page-body">
        <div class="container-xl">
          {props.flash ? <FlashAlert flash={props.flash} /> : null}

          {/* 미연결 구성요소 백필 배너 */}
          {props.unlinkedCount > 0 ? (
            <BackfillBanner count={props.unlinkedCount} />
          ) : null}

          {props.groupSummaries.length > 0 ? (
            <GroupFilterBar groups={props.groupSummaries} filters={filters} />
          ) : null}

          {/* v3.5 솔루션 필터바 (카테고리/영향시스템/심각도/상태/검색) */}
          <SolutionFilterBar filters={filters} />

          {props.activeCategory ? <CategoryActiveBanner filters={filters} /> : null}
          {props.activeImpact ? <ImpactActiveBanner filters={filters} /> : null}

          {/* grouped(기본) 뷰 = 부모 자산 카드 목록 */}
          {props.view === 'grouped' ? (
            <GroupedAssetView
              assets={props.assets}
              matchesBySolution={props.matchesBySolution}
              isAdmin={isAdmin}
            />
          ) : (
            /* list(평면) 뷰 = 기존 솔루션 행 테이블 */
            <div class="card">
              <div class="card-body p-0">
                <div class="table-responsive">
                  <table id="flat-table" class="table table-vcenter table-hover mb-0 vm-table">
                    {/* 고정폭 — 카테고리(11rem)는 긴 한글 라벨 수용, 나머지도 겹침 방지 폭 확보 */}
                    <colgroup>
                      <col style="width:2.5rem"/>
                      <col style="width:8rem"/>
                      <col style="width:8rem"/>
                      <col style="width:9rem"/>
                      <col style="width:11rem"/>
                      <col style="width:6.5rem"/>
                      <col style="width:7rem"/>
                      <col style="width:7.5rem"/>
                      <col style="width:7rem"/>
                      <col style="width:7rem"/>
                      <col style="width:7rem"/>
                    </colgroup>
                    <thead>
                      <tr>
                        <th></th>
                        <th class="vm-th-sort" data-sort="status">상태<span class="vm-sort-ind"></span></th>
                        <th class="vm-th-sort" data-sort="vendor">벤더<span class="vm-sort-ind"></span></th>
                        <th class="vm-th-sort" data-sort="product">제품<span class="vm-sort-ind"></span></th>
                        <th class="vm-th-sort" data-sort="category">카테고리<span class="vm-sort-ind"></span></th>
                        <th>버전</th>
                        <th class="vm-th-sort" data-sort="group">그룹사<span class="vm-sort-ind"></span></th>
                        <th>호스트명</th>
                        <th class="vm-th-sort" data-sort="owner">부서<span class="vm-sort-ind"></span></th>
                        <th class="vm-th-sort" data-sort="manager">담당자<span class="vm-sort-ind"></span></th>
                        <th class="w-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.solutions.length === 0 ? (
                        <tr>
                          <td colspan={11}>
                            <div class="empty">
                              <p class="empty-title">등록된 솔루션이 없습니다</p>
                              <p class="empty-subtitle text-muted">
                                상단의 <strong>장비 등록</strong> 또는 <strong>CSV 일괄 등록</strong> 버튼을 누르세요.
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        props.solutions.map((s) => (
                          <SolutionRow
                            solution={s}
                            matches={props.matchesBySolution.get(s.id) ?? []}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 모달들 */}
      <SolutionModal
        groupSuggestions={props.groupSummaries.map((g) => g.name)}
        userGroups={props.currentUser?.groups ?? []}
        isAdmin={isAdmin}
        assetOptions={props.assetOptions}
        activeGroup={props.activeGroup}
      />
      <NewAssetModal
        groupSuggestions={props.groupSummaries.map((g) => g.name)}
        userGroups={props.currentUser?.groups ?? []}
        isAdmin={isAdmin}
        activeGroup={props.activeGroup}
      />
      <BulkUploadModal />
      {/* 부모 자산 수정 모달 */}
      <AssetEditModal
        groupSuggestions={props.groupSummaries.map((g) => g.name)}
        userGroups={props.currentUser?.groups ?? []}
        isAdmin={isAdmin}
      />
      {/* 수동 취약 표시 모달 */}
      <VulnMarkModal />
      <VulnResolveModal />

      {raw(`<script>
var CATEGORY_METADATA = ${JSON.stringify(CATEGORY_METADATA)};
document.addEventListener('DOMContentLoaded', function() {
  // === CVE/속성 펼침 토글 (솔루션 행 + 컴포넌트 행 공통) ===
  document.querySelectorAll('[data-toggle-cves]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.getAttribute('data-toggle-cves');
      var row = document.getElementById('solcves-' + id);
      if (!row) return;
      var hidden = row.classList.toggle('d-none');
      btn.setAttribute('aria-expanded', String(!hidden));
      var icon = btn.querySelector('i');
      if (icon) {
        icon.classList.toggle('ti-chevron-down', hidden);
        icon.classList.toggle('ti-chevron-up', !hidden);
      }
    });
  });

  // === 평면(list) 뷰 컬럼 정렬 (클라이언트) ===
  (function initFlatSort() {
    var table = document.getElementById('flat-table');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    if (!tbody) return;
    var ths = table.querySelectorAll('th.vm-th-sort');
    var sortState = { key: null, dir: 1 };
    ths.forEach(function(th) {
      th.addEventListener('click', function() {
        var key = th.getAttribute('data-sort');
        if (sortState.key === key) { sortState.dir = -sortState.dir; }
        else { sortState.key = key; sortState.dir = 1; }
        ths.forEach(function(h) {
          var i = h.querySelector('.vm-sort-ind');
          if (i) i.textContent = '';
          h.classList.remove('is-sorted');
        });
        var ind = th.querySelector('.vm-sort-ind');
        if (ind) ind.textContent = sortState.dir > 0 ? ' ↑' : ' ↓';
        th.classList.add('is-sorted');
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-row="main"]'));
        rows.sort(function(a, b) {
          var va = a.getAttribute('data-' + key) || '';
          var vb = b.getAttribute('data-' + key) || '';
          if (va < vb) return -sortState.dir;
          if (va > vb) return sortState.dir;
          return 0;
        });
        rows.forEach(function(r) {
          tbody.appendChild(r);
          var det = document.getElementById('solcves-' + r.getAttribute('data-id'));
          if (det) tbody.appendChild(det);
        });
      });
    });
  })();

  // === 카테고리 변경 시 current_version 라벨/placeholder 동적 갱신 ===
  function updateVersionLabel(category) {
    var meta = CATEGORY_METADATA[category];
    var versionLabel = document.getElementById('current-version-label');
    var versionInput = document.querySelector('#solution-form [name="current_version"]');
    if (versionLabel) versionLabel.textContent = meta ? meta.versionLabel : '현재 버전';
    if (versionInput) versionInput.setAttribute('placeholder', (meta && meta.versionPlaceholder) || '예: 1.0.0');
  }
  var catSelect = document.querySelector('#solution-form [name="category"]');
  if (catSelect) {
    catSelect.addEventListener('change', function() {
      updateVersionLabel(catSelect.value);
    });
  }

  // === 솔루션(구성요소) 수정 모달 채움 ===
  var modal = document.getElementById('solution-modal');
  if (modal) {
    modal.addEventListener('show.bs.modal', function(event) {
      var btn = event.relatedTarget;
      if (!btn) return;
      var mode = btn.getAttribute('data-mode') || 'create';
      var form = document.getElementById('solution-form');
      form.reset();
      var title = document.getElementById('modal-title');
      var submitBtn = document.getElementById('submit-btn');
      var cpeStatus = document.getElementById('cpe-status');
      if (cpeStatus) cpeStatus.textContent = '';
      var cpeSuggestions = document.getElementById('cpe-suggestions');
      if (cpeSuggestions) cpeSuggestions.innerHTML = '';

      if (mode === 'edit') {
        var id = btn.getAttribute('data-id');
        form.action = '/solutions/' + id;
        title.textContent = '솔루션 수정';
        submitBtn.textContent = '수정 저장';
        ['vendor','product','category','current_version','hostname','owner','manager','notes','group_company','cpe_part','cpe_version_range','aliases','cpe_uri'].forEach(function(k) {
          var attrName = 'data-' + k.replace(/_/g, '-');
          var value = btn.getAttribute(attrName) || '';
          var el = form.elements[k];
          if (el) el.value = value;
        });
        updateVersionLabel(form.elements['category'].value);
        // asset_id 숨김 필드 채움
        var assetIdInput = document.getElementById('solution-asset-id');
        if (assetIdInput) assetIdInput.value = btn.getAttribute('data-asset-id') || '';
        // 편집 모드에서는 부모 선택 드롭다운 숨김
        var assetSelectWrap = document.getElementById('asset-select-wrap');
        if (assetSelectWrap) assetSelectWrap.style.display = 'none';
      } else {
        form.action = '/solutions';
        title.textContent = '새 솔루션 등록';
        submitBtn.textContent = '등록';
        updateVersionLabel('');
        // 생성 모드에서 부모 선택 드롭다운 표시
        var assetSelectWrap = document.getElementById('asset-select-wrap');
        if (assetSelectWrap) assetSelectWrap.style.display = '';
      }
    });
  }

  // === CPE 자동완성 (vendor/product 입력 → /api/cpe/suggest) ===
  var cpeTimer = null;
  function lookupCpe() {
    var form = document.getElementById('solution-form');
    if (!form) return;
    var vendor = form.elements['vendor'].value.trim();
    var product = form.elements['product'].value.trim();
    if (vendor.length < 2 || product.length < 2) return;
    var box = document.getElementById('cpe-suggestions');
    var status = document.getElementById('cpe-status');
    if (status) status.textContent = '조회 중…';
    if (box) box.innerHTML = '';

    fetch('/api/cpe/suggest?q=' + encodeURIComponent(vendor + ' ' + product), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (!j || !j.success) {
          if (status) status.textContent = '추천 실패 (수동 입력 가능)';
          return;
        }
        var items = j.data || [];
        if (status) status.textContent = items.length + '개 후보';
        items.forEach(function(it) {
          var li = document.createElement('button');
          li.type = 'button';
          li.className = 'list-group-item list-group-item-action py-1' + (it.deprecated ? ' text-muted' : '');
          // v3.6 XSS 방어 — NVD 유래 데이터(cpe_part/title/vendor/product)를 innerHTML 대신
          //   textContent 로 삽입(마크업 비활성화). 외부 출처 데이터를 신뢰하지 않는다.
          var code = document.createElement('code');
          code.className = 'me-1';
          code.textContent = it.cpe_part || '';
          var small = document.createElement('small');
          small.textContent = it.title || ((it.vendor || '') + ' / ' + (it.product || ''));
          li.appendChild(code);
          li.appendChild(small);
          if (it.deprecated) {
            var badge = document.createElement('span');
            badge.className = 'badge bg-yellow-lt ms-1';
            badge.textContent = 'deprecated';
            small.appendChild(document.createTextNode(' '));
            small.appendChild(badge);
          }
          li.addEventListener('click', function() {
            form.elements['cpe_part'].value = it.cpe_part;
            if (status) status.textContent = '선택됨: ' + it.cpe_part;
          });
          if (box) box.appendChild(li);
        });
      })
      .catch(function() {
        if (status) status.textContent = '조회 실패';
      });
  }
  ['vendor','product'].forEach(function(name) {
    var el = document.querySelector('#solution-form [name="' + name + '"]');
    if (!el) return;
    el.addEventListener('input', function() {
      clearTimeout(cpeTimer);
      cpeTimer = setTimeout(lookupCpe, 500);
    });
  });
  var lookupBtn = document.getElementById('cpe-lookup-btn');
  if (lookupBtn) lookupBtn.addEventListener('click', lookupCpe);

  // === 부모 자산 수정 모달 채움 ===
  var assetEditModal = document.getElementById('asset-edit-modal');
  if (assetEditModal) {
    assetEditModal.addEventListener('show.bs.modal', function(event) {
      var btn = event.relatedTarget;
      if (!btn) return;
      var form = document.getElementById('asset-edit-form');
      if (!form) return;
      var id = btn.getAttribute('data-asset-id') || '';
      form.action = '/solutions/asset/' + id;
      // 각 필드 채움 (impact_system 포함 — select 도 .value 설정으로 동작)
      var fields = ['name','vendor','hostname','group_company','owner','manager','notes','impact_system'];
      fields.forEach(function(k) {
        var attrName = 'data-' + k.replace(/_/g, '-');
        var value = btn.getAttribute(attrName) || '';
        var el = form.elements[k];
        if (el) el.value = value;
      });
    });
  }

  // === 수동 취약 표시 모달 채움 (#vuln-mark-modal) ===
  var vulnMarkModal = document.getElementById('vuln-mark-modal');
  if (vulnMarkModal) {
    vulnMarkModal.addEventListener('show.bs.modal', function(event) {
      var btn = event.relatedTarget;
      if (!btn) return;
      var form = document.getElementById('vuln-mark-form');
      if (!form) return;
      var id = btn.getAttribute('data-id') || '0';
      form.action = '/solutions/' + id + '/vuln-status';
      form.reset();
      // 대상 컴포넌트 표시
      var vendor = btn.getAttribute('data-vendor') || '';
      var product = btn.getAttribute('data-product') || '';
      var targetEl = document.getElementById('vuln-mark-target');
      if (targetEl) targetEl.textContent = vendor + ' / ' + product;
    });
  }

  // === 조치완료 모달 채움 (#vuln-resolve-modal) ===
  var vulnResolveModal = document.getElementById('vuln-resolve-modal');
  if (vulnResolveModal) {
    vulnResolveModal.addEventListener('show.bs.modal', function(event) {
      var btn = event.relatedTarget;
      if (!btn) return;
      var form = document.getElementById('vuln-resolve-form');
      if (!form) return;
      var id = btn.getAttribute('data-id') || '0';
      form.action = '/solutions/' + id + '/vuln-status';
      form.reset();
      var vendor = btn.getAttribute('data-vendor') || '';
      var product = btn.getAttribute('data-product') || '';
      var targetEl = document.getElementById('vuln-resolve-target');
      if (targetEl) targetEl.textContent = vendor + ' / ' + product;
    });
  }

  // === 장비 등록 (asset modal) — equipment 형식 ===
  var assetModal = document.getElementById('asset-modal');
  var assetForm = document.getElementById('asset-form');
  var extraBody = document.getElementById('extra-components-body');
  var extraAddBtn = document.getElementById('extra-add-row-btn');

  function getAssetVal(id) {
    var el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
  }
  function setAssetVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v || '';
  }

  // === 추가 컴포넌트 동적 행 ===
  function createExtraRow() {
    var tr = document.createElement('tr');
    tr.className = 'extra-row';
    var sel = '<select class="form-select form-select-sm extra-cell-category">';
    Object.keys(CATEGORY_METADATA).forEach(function(k) {
      var selected = k === 'Library' ? ' selected' : '';
      sel += '<option value="' + k + '"' + selected + '>' + CATEGORY_METADATA[k].displayName + '</option>';
    });
    sel += '</select>';
    tr.innerHTML =
      '<td>' + sel + '</td>' +
      '<td><input type="text" class="form-control form-control-sm extra-cell-product" placeholder="예: OpenSSH / Docker / Redis"></td>' +
      '<td><input type="text" class="form-control form-control-sm extra-cell-version" placeholder="예: 9.6"></td>' +
      '<td><button type="button" class="btn btn-sm btn-icon text-danger extra-row-remove" aria-label="행 제거"><i class="ti ti-x"></i></button></td>';
    return tr;
  }
  if (extraAddBtn && extraBody) {
    extraAddBtn.addEventListener('click', function() {
      extraBody.appendChild(createExtraRow());
    });
  }
  if (extraBody) {
    extraBody.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.extra-row-remove');
      if (!btn) return;
      var tr = btn.closest('.extra-row');
      if (tr) tr.parentNode.removeChild(tr);
    });
  }

  // 추가 컴포넌트 행들 → JSON 배열로 수집 (빈 행 무시, 부분 입력 행은 경고)
  function collectExtraComponents() {
    var result = { items: [], warnings: [] };
    if (!extraBody) return result;
    var rows = extraBody.querySelectorAll('.extra-row');
    rows.forEach(function(tr, idx) {
      var cat = (tr.querySelector('.extra-cell-category')?.value || '').trim();
      var prod = (tr.querySelector('.extra-cell-product')?.value || '').trim();
      var ver = (tr.querySelector('.extra-cell-version')?.value || '').trim();
      var anyFilled = cat || prod || ver;
      if (!anyFilled) return;
      if (!cat || !prod || !ver) {
        result.warnings.push('추가 컴포넌트 ' + (idx + 1) + '번 행: 카테고리/제품/버전 모두 입력하거나 모두 비워주세요.');
        return;
      }
      result.items.push({ category: cat, product: prod, version: ver });
    });
    return result;
  }

  // prefill: AssetCard 의 "구성요소 추가" 버튼에서 hostname/group 받아 채우기
  if (assetModal) {
    assetModal.addEventListener('show.bs.modal', function(event) {
      var btn = event.relatedTarget;
      ['asset-vendor','asset-model','asset-hostname','asset-os-version',
       'asset-hw-version','asset-openssl-version',
       'asset-db-engine','asset-db-version',
       'asset-web-engine','asset-web-version',
       'asset-was-engine','asset-was-version',
       'asset-owner','asset-manager'].forEach(function(id) { setAssetVal(id, ''); });
      if (extraBody) extraBody.innerHTML = '';
      var statusBox = document.getElementById('asset-status');
      if (statusBox) statusBox.innerHTML = '';
      if (btn) {
        // v3.6 그룹사는 활성 그룹사로 서버가 자동 결정 — prefill 불필요(hostname 만 유지).
        var preHost = btn.getAttribute('data-prefill-hostname');
        if (preHost) setAssetVal('asset-hostname', preHost);
      }
    });
  }

  if (assetForm) {
    assetForm.addEventListener('submit', function(ev) {
      ev.preventDefault();
      var statusBox = document.getElementById('asset-status');
      var submitBtn = document.getElementById('asset-submit-btn');

      var vendor = getAssetVal('asset-vendor');
      var model = getAssetVal('asset-model');
      var hostname = getAssetVal('asset-hostname');
      var osVersion = getAssetVal('asset-os-version');

      var missing = [];
      if (!vendor) missing.push('벤더');
      if (!model) missing.push('장비모델');
      if (!hostname) missing.push('Hostname');
      if (!osVersion) missing.push('OS 버전');
      if (missing.length > 0) {
        statusBox.innerHTML = '<div class="alert alert-warning mb-0">필수 항목 누락: ' + missing.join(', ') + '</div>';
        return;
      }

      var dbEng = getAssetVal('asset-db-engine');
      var dbVer = getAssetVal('asset-db-version');
      var webEng = getAssetVal('asset-web-engine');
      var webVer = getAssetVal('asset-web-version');
      var wasEng = getAssetVal('asset-was-engine');
      var wasVer = getAssetVal('asset-was-version');

      var pairWarn = [];
      if (dbEng && !dbVer) pairWarn.push('DB 엔진(' + dbEng + ')은 버전 입력이 필요합니다.');
      if (!dbEng && dbVer) pairWarn.push('DB 버전이 입력됐지만 엔진(MySQL/PostgreSQL 등)이 선택되지 않았습니다.');
      if (webEng && !webVer) pairWarn.push('WEB 엔진(' + webEng + ')은 버전 입력이 필요합니다.');
      if (!webEng && webVer) pairWarn.push('WEB 버전이 입력됐지만 엔진(Apache/Nginx 등)이 선택되지 않았습니다.');
      if (wasEng && !wasVer) pairWarn.push('WAS 엔진(' + wasEng + ')은 버전 입력이 필요합니다.');
      if (!wasEng && wasVer) pairWarn.push('WAS 버전이 입력됐지만 엔진(Tomcat/JBoss 등)이 선택되지 않았습니다.');

      var extraCollected = collectExtraComponents();
      if (extraCollected.warnings.length > 0) {
        pairWarn = pairWarn.concat(extraCollected.warnings);
      }

      if (pairWarn.length > 0) {
        statusBox.innerHTML = '<div class="alert alert-warning mb-0"><ul class="mb-0">' +
          pairWarn.map(function(s){ return '<li>' + s + '</li>'; }).join('') +
          '</ul></div>';
        return;
      }

      var payload = {
        vendor: vendor,
        model: model,
        hostname: hostname,
        os_version: osVersion,
        hw_version: getAssetVal('asset-hw-version') || null,
        openssl_version: getAssetVal('asset-openssl-version') || null,
        db_engine: dbEng || null,
        db_version: dbVer || null,
        web_engine: webEng || null,
        web_version: webVer || null,
        was_engine: wasEng || null,
        was_version: wasVer || null,
        extra_components: extraCollected.items.length > 0 ? extraCollected.items : null,
        group_company: null, // v3.6 서버(resolveWriteGroup)가 활성 그룹사로 강제 결정 — 클라이언트 값 미신뢰
        owner: getAssetVal('asset-owner') || null,
        manager: getAssetVal('asset-manager') || null,
      };

      submitBtn.disabled = true;
      statusBox.innerHTML = '<div class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>등록 중…</div>';

      fetch('/api/solutions/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify([payload]),
      })
        .then(function(r) { return r.json().then(function(j) { return { status: r.status, body: j }; }); })
        .then(function(res) {
          submitBtn.disabled = false;
          var d = res.body && res.body.data;
          if (!d) {
            statusBox.innerHTML = '<div class="alert alert-danger mb-0">' + (res.body && res.body.error || '알 수 없는 오류') + '</div>';
            return;
          }
          var cls = d.errors.length === 0 ? 'alert-success' : 'alert-warning';
          var html = '<div class="alert ' + cls + ' mb-2">장비 1대 등록 → <strong>' + d.created + '개 컴포넌트</strong> 저장됨';
          if (d.errors.length > 0) html += ' / 실패 ' + d.errors.length + '건';
          html += '</div>';
          if (d.errors.length > 0) {
            html += '<ul class="text-danger small">';
            d.errors.forEach(function(e) {
              html += '<li>' + (e.product || '') + ': ' + e.error + '</li>';
            });
            html += '</ul>';
          }
          if (d.created > 0) {
            html += '<div class="text-muted">2초 후 페이지를 새로고침합니다…</div>';
            setTimeout(function() { window.location.reload(); }, 2000);
          }
          statusBox.innerHTML = html;
        })
        .catch(function(err) {
          submitBtn.disabled = false;
          statusBox.innerHTML = '<div class="alert alert-danger mb-0">요청 실패: ' + err.message + '</div>';
        });
    });
  }

  // === CSV 일괄 등록 ===
  var bulkForm = document.getElementById('bulk-form');
  if (bulkForm) {
    bulkForm.addEventListener('submit', function(ev) {
      ev.preventDefault();
      var fileInput = document.getElementById('bulk-file');
      var statusBox = document.getElementById('bulk-status');
      var submitBtn = document.getElementById('bulk-submit-btn');
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        statusBox.innerHTML = '<div class="alert alert-warning mb-0">파일을 선택하세요.</div>';
        return;
      }
      var fd = new FormData();
      fd.append('file', fileInput.files[0]);
      submitBtn.disabled = true;
      statusBox.innerHTML = '<div class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>업로드 중...</div>';
      fetch('/api/solutions/bulk', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      })
        .then(function(r) { return r.json().then(function(j) { return { status: r.status, body: j }; }); })
        .then(function(res) {
          submitBtn.disabled = false;
          var d = res.body && res.body.data;
          if (!d) {
            statusBox.innerHTML = '<div class="alert alert-danger mb-0">' + (res.body && res.body.error || '알 수 없는 오류') + '</div>';
            return;
          }
          var cls = d.errors.length === 0 ? 'alert-success' : 'alert-warning';
          var unitLabel = d.kind === 'equipment' ? '장비' : '솔루션';
          var summary = d.kind === 'equipment'
            ? '장비 ' + d.total + '대 → ' + d.created + '개 솔루션 등록'
            : '총 ' + d.total + '건 중 ' + d.created + '건 등록';
          var html = '<div class="alert ' + cls + ' mb-2"><strong>' + summary + '</strong>' +
            (d.errors.length > 0 ? ' · 실패 ' + d.errors.length + '건' : '') + '</div>';
          if (d.errors.length > 0) {
            html += '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>행</th><th>벤더</th><th>' + unitLabel + '</th><th>오류</th></tr></thead><tbody>';
            d.errors.slice(0, 50).forEach(function(e) {
              html += '<tr><td>' + e.row + '</td><td>' + (e.vendor || '') + '</td><td>' + (e.product || '') + '</td><td class="text-danger">' + e.error + '</td></tr>';
            });
            html += '</tbody></table></div>';
            if (d.errors.length > 50) html += '<div class="text-muted">…및 ' + (d.errors.length - 50) + '건 더</div>';
          }
          if (d.created > 0) {
            html += '<div class="text-muted">잠시 후 페이지를 새로고침하면 등록된 솔루션이 표시됩니다.</div>';
          }
          statusBox.innerHTML = html;
        })
        .catch(function(err) {
          submitBtn.disabled = false;
          statusBox.innerHTML = '<div class="alert alert-danger mb-0">요청 실패: ' + err.message + '</div>';
        });
    });
  }
});
</script>`)}
    </Layout>
  )
}

// ============================================================
// ViewToggle — [솔루션별(기본)] [개별(평면)]
// ============================================================
function ViewToggle(props: { filters: SolutionFilters }) {
  // 모든 활성 필터를 보존하며 view 만 교체
  const groupedHref = buildSolutionsQuery({ ...props.filters, view: 'grouped' })
  const listHref = buildSolutionsQuery({ ...props.filters, view: 'list' })
  const isList = props.filters.view === 'list'
  return (
    <div class="btn-group" role="group" aria-label="뷰 전환">
      <a
        href={groupedHref}
        class={`btn btn-sm ${!isList ? 'btn-primary' : 'btn-outline-secondary'}`}
        title="부모 솔루션(자산) 카드 단위 보기 — 기본"
      >
        <i class="ti ti-layout-cards me-1"></i>솔루션별(기본)
      </a>
      <a
        href={listHref}
        class={`btn btn-sm ${isList ? 'btn-primary' : 'btn-outline-secondary'}`}
        title="개별 구성요소 행 단위 보기 — 평면"
      >
        <i class="ti ti-list me-1"></i>개별(평면)
      </a>
    </div>
  )
}

// ============================================================
// 솔루션 필터바 (카테고리/영향시스템/심각도/상태/검색) — GET 폼
// ============================================================
function SolutionFilterBar(props: { filters: SolutionFilters }) {
  const f = props.filters
  const hasActive = !!(f.category || f.impact || f.minSeverity || f.vulnStatus || f.q)
  return (
    <form method="get" action="/solutions" class="card mb-3">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-6 col-md">
            <label class="form-label small mb-1 text-muted">카테고리</label>
            <select name="category" class="form-select form-select-sm">
              <option value="">전체</option>
              {CATEGORY_KEYS.map((k) => (
                <option value={k} selected={k === f.category}>
                  {CATEGORY_METADATA[k].displayName}
                </option>
              ))}
            </select>
          </div>
          <div class="col-6 col-md">
            <label class="form-label small mb-1 text-muted">영향 시스템</label>
            <select name="impact" class="form-select form-select-sm">
              <option value="">전체</option>
              {IMPACT_SYSTEM_OPTIONS.map((o) => (
                <option value={o.code} selected={o.code === f.impact}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div class="col-6 col-md">
            <label class="form-label small mb-1 text-muted">최소 심각도</label>
            <select name="min_severity" class="form-select form-select-sm">
              <option value="">전체</option>
              <option value="critical" selected={f.minSeverity === 'critical'}>Critical</option>
              <option value="high" selected={f.minSeverity === 'high'}>High 이상</option>
              <option value="medium" selected={f.minSeverity === 'medium'}>Medium 이상</option>
              <option value="low" selected={f.minSeverity === 'low'}>Low 이상</option>
            </select>
          </div>
          <div class="col-6 col-md">
            <label class="form-label small mb-1 text-muted">상태</label>
            <select name="vuln_status" class="form-select form-select-sm">
              <option value="">전체</option>
              <option value="vulnerable" selected={f.vulnStatus === 'vulnerable'}>취약만</option>
              <option value="safe" selected={f.vulnStatus === 'safe'}>정상만</option>
            </select>
          </div>
          <div class="col-12 col-md-3">
            <label class="form-label small mb-1 text-muted">검색</label>
            <input
              type="search"
              name="q"
              class="form-control form-control-sm"
              placeholder="벤더 · 제품 · 호스트명"
              value={f.q ?? ''}
            />
          </div>
          {f.group ? <input type="hidden" name="group" value={f.group} /> : null}
          {f.view === 'list' ? <input type="hidden" name="view" value="list" /> : null}
          <div class="col-12 col-md-auto d-flex gap-2">
            <button type="submit" class="btn btn-sm btn-primary">
              <i class="ti ti-filter me-1"></i>필터 적용
            </button>
            {hasActive ? (
              <a
                href={buildSolutionsQuery({
                  ...f,
                  category: null,
                  impact: null,
                  minSeverity: null,
                  vulnStatus: null,
                  q: null,
                })}
                class="btn btn-sm btn-link"
              >
                초기화
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  )
}

// ============================================================
// 백필 배너 — 미연결 구성요소가 있을 때 상단 표시
// ============================================================
function BackfillBanner(props: { count: number }) {
  return (
    <div class="alert alert-warning d-flex align-items-center mb-3">
      <i class="ti ti-alert-triangle me-2 flex-shrink-0"></i>
      <div class="flex-grow-1">
        아직 솔루션으로 묶이지 않은 구성요소 <strong>{props.count}건</strong>이 있습니다.
      </div>
      <form method="post" action="/solutions/assets/backfill" class="ms-3 flex-shrink-0">
        <button type="submit" class="btn btn-sm btn-warning">
          <i class="ti ti-link me-1"></i>지금 묶기
        </button>
      </form>
    </div>
  )
}

// ============================================================
// Grouped 뷰 — 부모 자산 카드 목록
// ============================================================
function GroupedAssetView(props: {
  assets: AssetWithComponents[]
  matchesBySolution: Map<number, MatchedVuln[]>
  isAdmin: boolean
}) {
  if (props.assets.length === 0) {
    return (
      <div class="card">
        <div class="card-body">
          <div class="empty">
            <p class="empty-title">등록된 자산이 없습니다</p>
            <p class="empty-subtitle text-muted">
              상단의 <strong>장비 등록</strong> 버튼으로 호스트별 OS/DB/펌웨어 버전을 한 번에 등록하세요.
            </p>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div class="row row-cards g-3">
      {props.assets.map((aw) => (
        <ParentAssetCard
          assetWithComponents={aw}
          matchesBySolution={props.matchesBySolution}
          isAdmin={props.isAdmin}
        />
      ))}
    </div>
  )
}

// ============================================================
// 부모 자산 카드 (ParentAssetCard)
// ============================================================
function ParentAssetCard(props: {
  assetWithComponents: AssetWithComponents
  matchesBySolution: Map<number, MatchedVuln[]>
  isAdmin: boolean
}) {
  const { asset, components, componentCount, vulnerableCount, hasVulnerable } = props.assetWithComponents
  const confirmMsg = `자산 "${asset.name}"과 소속 구성요소 ${componentCount}건을 모두 삭제하시겠습니까?`

  return (
    <div class="col-12">
      <div class={`card vm-card${hasVulnerable ? ' is-vuln' : ''}`}>
        {/* 카드 헤더 — 자산 메타 + 상태 롤업 */}
        <div class="card-header py-3 vm-card__head">
          <div class="d-flex align-items-start flex-wrap gap-2 flex-grow-1">
            {/* 상태 롤업 */}
            <div class="me-2 flex-shrink-0">
              {hasVulnerable ? (
                <span class="vm-rollup vm-pill vm-pill--vuln" title={`취약 컴포넌트 ${vulnerableCount}건`}>
                  <span class="vm-dot"></span>
                  <i class="ti ti-shield-exclamation me-1"></i>취약 {vulnerableCount}
                </span>
              ) : (
                <span class="vm-rollup vm-pill vm-pill--ok">
                  <span class="vm-dot"></span>
                  <i class="ti ti-shield-check me-1"></i>정상
                </span>
              )}
            </div>

            {/* 자산명 */}
            <div class="flex-grow-1 min-width-0">
              <h3 class="card-title mb-1">
                <i class="ti ti-server-2 me-2 text-azure"></i>
                <strong>{asset.name}</strong>
              </h3>
              <div class="d-flex flex-wrap gap-2 align-items-center small text-muted">
                {asset.impact_system ? (
                  <span
                    class="badge bg-azure-lt"
                    title={`영향 시스템${asset.impact_system_source === 'manual' ? ' (수동 확정)' : ' (자동 분류)'}`}
                  >
                    <i class="ti ti-affiliate me-1"></i>
                    {impactSystemLabel(asset.impact_system)}
                    {asset.impact_system_source === 'manual' ? (
                      <i class="ti ti-lock ms-1" style="font-size:0.8em"></i>
                    ) : null}
                  </span>
                ) : (
                  <span class="badge bg-secondary-lt" title="영향 시스템 미분류">
                    <i class="ti ti-help me-1"></i>미분류
                  </span>
                )}
                {asset.group_company ? (
                  <span class="badge bg-purple-lt">
                    <i class="ti ti-building me-1"></i>{asset.group_company}
                  </span>
                ) : null}
                {asset.hostname ? (
                  <span>
                    <i class="ti ti-server-2 me-1"></i>{asset.hostname}
                  </span>
                ) : null}
                {asset.owner ? (
                  <span title="부서">
                    <i class="ti ti-users-group me-1"></i>{asset.owner}
                  </span>
                ) : null}
                {asset.manager ? (
                  <span title="담당자">
                    <i class="ti ti-user me-1"></i>{asset.manager}
                  </span>
                ) : null}
                <span class="badge bg-secondary-lt">
                  컴포넌트 {componentCount}
                </span>
                {asset.vendor ? (
                  <span>{asset.vendor}</span>
                ) : null}
              </div>
            </div>
          </div>

          {/* 카드 액션 버튼들 — 헤더가 2줄로 길어도 상단에 붙지 않도록 세로 중앙 정렬 */}
          <div class="card-actions d-flex flex-wrap gap-1 flex-shrink-0 align-self-center">
            {/* 구성요소 추가 — 기존 #asset-modal 재활용, hostname/group prefill */}
            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              data-bs-toggle="modal"
              data-bs-target="#asset-modal"
              data-prefill-hostname={asset.hostname ?? ''}
              data-prefill-group={asset.group_company ?? ''}
              title="이 자산에 구성요소 추가"
            >
              <i class="ti ti-plus me-1"></i>구성요소 추가
            </button>

            {/* 부모 수정 — #asset-edit-modal prefill */}
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              data-bs-toggle="modal"
              data-bs-target="#asset-edit-modal"
              data-asset-id={String(asset.id)}
              data-name={asset.name}
              data-vendor={asset.vendor ?? ''}
              data-hostname={asset.hostname ?? ''}
              data-group-company={asset.group_company ?? ''}
              data-owner={asset.owner ?? ''}
              data-manager={asset.manager ?? ''}
              data-notes={asset.notes ?? ''}
              data-impact-system={asset.impact_system ?? ''}
              title="자산 정보 수정"
            >
              <i class="ti ti-edit me-1"></i>수정
            </button>

            {/* 부모 삭제 — POST /solutions/asset/{id}/delete */}
            <form
              method="post"
              action={`/solutions/asset/${asset.id}/delete`}
              class="d-inline"
              onsubmit={`return confirm('${confirmMsg.replace(/'/g, "\\'")}');`}
            >
              <button type="submit" class="btn btn-sm btn-outline-danger" title="자산 및 구성요소 일괄 삭제">
                <i class="ti ti-trash me-1"></i>삭제
              </button>
            </form>
          </div>
        </div>

        {/* 카드 바디 — 컴포넌트 표 */}
        <div class="table-responsive">
          <table class="table table-sm table-vcenter mb-0 vm-table">
            {/* 고정폭 — 카드 간 컬럼 정렬 + 한글 라벨 오버플로(겹침) 방지.
                카테고리 12rem 는 가장 긴 라벨('WAS (애플리케이션 서버)')도 한 줄에 수용. */}
            <colgroup>
              <col style="width:2.5rem"/>
              <col style="width:9rem"/>
              <col style="width:13rem"/>
              <col/>
              <col style="width:8rem"/>
              <col style="width:4rem"/>
              <col style="width:8rem"/>
            </colgroup>
            <thead>
              <tr>
                <th></th>
                <th>상태</th>
                <th>카테고리</th>
                <th>벤더 · 제품</th>
                <th>버전</th>
                <th>CVE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {components.length === 0 ? (
                <tr>
                  <td colspan={7} class="text-center text-muted py-2">
                    구성요소가 없습니다
                  </td>
                </tr>
              ) : (
                components.map((s) => (
                  <AssetComponentRow
                    solution={s}
                    matches={props.matchesBySolution.get(s.id) ?? []}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 컴포넌트 행 (자산 카드 내부 테이블용)
// ============================================================
function AssetComponentRow(props: { solution: Solution; matches: MatchedVuln[] }) {
  const s = props.solution
  const cveCount = props.matches.length
  const latest = props.matches[0]
  const parsedAttrs = parseAttrsJson(s.category_attributes)
  const hasAttrs = parsedAttrs !== null && Object.keys(parsedAttrs).length > 0
  // CVE 또는 속성이 있으면 펼침 토글 활성화
  const showToggle = hasAttrs || cveCount > 0
  const hasManual = s.manual_status === 'vulnerable' || s.manual_status === 'resolved'
  const needsAction = s.is_vulnerable === 1 || hasManual

  return (
    <>
      <tr class={s.manual_status === 'vulnerable' ? 'bg-red-lt' : s.manual_status === 'resolved' ? 'bg-teal-lt' : s.is_vulnerable === 1 ? 'bg-red-lt' : ''}>
        {/* 펼침 토글 */}
        <td>
          {showToggle ? (
            <button
              type="button"
              class="btn btn-sm btn-icon btn-ghost-secondary"
              data-toggle-cves={String(s.id)}
              aria-expanded="false"
              aria-label="속성/CVE 펼치기"
            >
              <i class="ti ti-chevron-down"></i>
            </button>
          ) : (
            <span class="text-muted">—</span>
          )}
        </td>
        {/* 상태 */}
        <td>
          <ComponentStatusCell solution={s} cveCount={cveCount} latestCveId={latest?.cve_id ?? null} />
        </td>
        {/* 카테고리 — vm-cat: 고정폭 셀을 넘치지 않도록 말줄임 처리 */}
        <td>
          <span class="badge bg-blue-lt vm-cat" title={categoryDisplayName(s.category)}>
            {categoryDisplayName(s.category)}
          </span>
        </td>
        {/* 벤더 · 제품 */}
        <td>
          <span class="vm-cell-vp" title={`${s.vendor} ${s.product}`}>
            <strong>{s.vendor}</strong>{' '}{s.product}
          </span>
        </td>
        {/* 버전 */}
        <td>
          <code>{s.current_version}</code>
        </td>
        {/* CVE 수 */}
        <td>
          {cveCount > 0 ? (
            <span class="badge bg-red text-white">{cveCount}</span>
          ) : (
            <span class="text-muted">—</span>
          )}
        </td>
        {/* 액션 */}
        <td class="text-end">
          <div class="btn-list flex-nowrap">
            <button
              type="button"
              class="btn btn-sm btn-icon"
              data-bs-toggle="modal"
              data-bs-target="#solution-modal"
              data-mode="edit"
              data-id={String(s.id)}
              data-vendor={s.vendor}
              data-product={s.product}
              data-category={s.category}
              data-current-version={s.current_version}
              data-hostname={s.hostname ?? ''}
              data-owner={s.owner ?? ''}
              data-manager={s.manager ?? ''}
              data-notes={s.notes ?? ''}
              data-group-company={s.group_company ?? ''}
              data-cpe-part={s.cpe_part ?? ''}
              data-cpe-version-range={s.cpe_version_range ?? ''}
              data-aliases={formatAliasesAttr(s.aliases)}
              data-cpe-uri={s.cpe_uri ?? ''}
              data-category-attributes={s.category_attributes ?? ''}
              data-asset-id={s.asset_id !== null ? String(s.asset_id) : ''}
              aria-label="수정"
            >
              <i class="ti ti-edit"></i>
            </button>
            <form
              method="post"
              action={`/solutions/${s.id}/delete`}
              class="d-inline"
              onsubmit={`return confirm('${s.vendor} ${s.product} 를 삭제하시겠습니까?');`}
            >
              <button type="submit" class="btn btn-sm btn-icon text-danger" aria-label="삭제">
                <i class="ti ti-trash"></i>
              </button>
            </form>
            {/* 수동 상태 액션 드롭다운 */}
            <VulnStatusDropdown solution={s} needsAction={needsAction} />
          </div>
        </td>
      </tr>
      {/* 펼침 행: CVE 목록 + 속성 카드 */}
      {showToggle ? (
        <tr id={`solcves-${s.id}`} class="d-none">
          <td colspan={7} class={s.is_vulnerable === 1 ? 'bg-red-lt' : 'bg-light'}>
            <div class="p-2">
              {hasAttrs ? <AttrCard category={s.category} attrs={parsedAttrs!} /> : null}
              {cveCount > 0 ? (
                <div class="card">
                  <div class="card-body p-2">
                    <div class="small text-muted mb-2">감지된 CVE {cveCount}건 (최근순)</div>
                    <div class="table-responsive">
                      <table class="table table-sm mb-0">
                        <thead>
                          <tr>
                            <th>CVE</th>
                            <th>심각도</th>
                            <th>출처</th>
                            <th>공개</th>
                            <th>감지</th>
                            <th>제목</th>
                          </tr>
                        </thead>
                        <tbody>
                          {props.matches.map((m) => (
                            <tr>
                              <td>
                                {m.url ? (
                                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                                    {m.cve_id ?? '—'}
                                  </a>
                                ) : (
                                  m.cve_id ?? '—'
                                )}
                              </td>
                              <td><SeverityBadge severity={m.severity} /></td>
                              <td><span class="badge bg-secondary-lt">{m.source ?? '—'}</span></td>
                              <td class="text-muted small">{m.published ?? '—'}</td>
                              <td class="text-muted small">{formatDate(m.detected_at)}</td>
                              <td class="text-truncate" style="max-width:28rem">{m.title ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ============================================================
// 부모 자산 수정 모달 (#asset-edit-modal)
// ============================================================
function AssetEditModal(props: { groupSuggestions: string[]; userGroups: string[]; isAdmin: boolean }) {
  return (
    <div
      class="modal modal-blur fade"
      id="asset-edit-modal"
      tabindex={-1}
      role="dialog"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="ti ti-edit me-2"></i>자산 수정
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          {/* action은 JS에서 data-asset-id를 읽어 동적으로 설정 */}
          <form id="asset-edit-form" method="post" action="/solutions/asset/0">
            <div class="modal-body" style="max-height: calc(100vh - 200px); overflow-y: auto;">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label required">자산명</label>
                  <input
                    type="text"
                    name="name"
                    class="form-control"
                    required
                    placeholder="예: SNIPER ONE-i 5300"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">벤더</label>
                  <input
                    type="text"
                    name="vendor"
                    class="form-control"
                    placeholder="예: Fortinet / Microsoft"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Hostname</label>
                  <input
                    type="text"
                    name="hostname"
                    class="form-control"
                    placeholder="예: fw-hq-01"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">그룹사</label>
                  {props.isAdmin ? (
                    <input
                      type="text"
                      name="group_company"
                      class="form-control"
                      list="asset-edit-group-list"
                      placeholder="예: 본사 (admin 자유 입력)"
                    />
                  ) : props.userGroups.length === 1 ? (
                    <input
                      type="text"
                      name="group_company"
                      class="form-control"
                      value={props.userGroups[0]}
                      readonly
                    />
                  ) : props.userGroups.length > 1 ? (
                    <select name="group_company" class="form-select">
                      {props.userGroups.map((g) => (
                        <option value={g}>{g}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      name="group_company"
                      class="form-control"
                      placeholder="담당 그룹사가 없습니다"
                      readonly
                    />
                  )}
                  <datalist id="asset-edit-group-list">
                    {props.groupSuggestions.map((name) => (
                      <option value={name}></option>
                    ))}
                  </datalist>
                </div>
                <div class="col-md-3">
                  <label class="form-label">부서</label>
                  <input
                    type="text"
                    name="owner"
                    class="form-control"
                    placeholder="예: 인프라팀 / 보안팀"
                  />
                </div>
                <div class="col-md-3">
                  <label class="form-label">담당자</label>
                  <input
                    type="text"
                    name="manager"
                    class="form-control"
                    placeholder="예: 홍길동"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">영향 시스템</label>
                  <select name="impact_system" class="form-select">
                    <option value="">자동 분류 (구성요소 기반)</option>
                    {IMPACT_SYSTEM_OPTIONS.map((o) => (
                      <option value={o.code}>
                        {o.label} — {o.description}
                      </option>
                    ))}
                  </select>
                  <small class="form-hint">
                    직접 선택하면 <strong>수동 확정</strong>되어 자동 재분류가 덮어쓰지 않습니다.
                  </small>
                </div>
                <div class="col-12">
                  <label class="form-label">비고</label>
                  <textarea name="notes" class="form-control" rows={2}></textarea>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn btn-primary">
                <i class="ti ti-check me-1"></i>수정 저장
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 그룹 필터 바
// ============================================================
function GroupFilterBar(props: { groups: GroupSummary[]; filters: SolutionFilters }) {
  const f = props.filters
  return (
    <div class="card mb-3">
      <div class="card-body py-2 d-flex flex-wrap gap-2 align-items-center">
        <span class="text-muted me-2">
          <i class="ti ti-building me-1"></i>그룹사
        </span>
        <a
          href={buildSolutionsQuery(f, { group: null })}
          class={`btn btn-sm ${f.group === null ? 'btn-primary' : 'btn-outline-secondary'}`}
        >
          전체
        </a>
        {props.groups.map((g) => {
          const active = f.group === g.name
          return (
            <a
              href={buildSolutionsQuery(f, { group: g.name })}
              class={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
            >
              {g.name}
              <span class="badge bg-secondary text-white ms-2">{g.total}</span>
              {g.vulnerable > 0 ? (
                <span class="badge bg-red text-white ms-1">{g.vulnerable}</span>
              ) : null}
            </a>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// 카테고리 / 영향시스템 활성 배너
// ============================================================
function CategoryActiveBanner(props: { filters: SolutionFilters }) {
  const f = props.filters
  return (
    <div class="alert alert-info mb-3 d-flex align-items-center">
      <i class="ti ti-filter me-2"></i>
      <div class="flex-grow-1">
        카테고리 <strong>{categoryDisplayName(f.category ?? '')}</strong> 만 표시 중
      </div>
      <a href={buildSolutionsQuery(f, { category: null })} class="btn btn-sm btn-outline-secondary">
        <i class="ti ti-x me-1"></i>해제
      </a>
    </div>
  )
}

function ImpactActiveBanner(props: { filters: SolutionFilters }) {
  const f = props.filters
  return (
    <div class="alert alert-info mb-3 d-flex align-items-center">
      <i class="ti ti-affiliate me-2"></i>
      <div class="flex-grow-1">
        영향 시스템 <strong>{impactSystemLabel(f.impact)}</strong> 만 표시 중
      </div>
      <a href={buildSolutionsQuery(f, { impact: null })} class="btn btn-sm btn-outline-secondary">
        <i class="ti ti-x me-1"></i>해제
      </a>
    </div>
  )
}

// ============================================================
// 평면(list) 뷰 개별 솔루션 행
// ============================================================
function SolutionRow(props: { solution: Solution; matches: MatchedVuln[] }) {
  const s = props.solution
  const matches = props.matches
  const cveCount = matches.length
  const latest = matches[0]
  const parsedAttrs = parseAttrsJson(s.category_attributes)
  const hasAttrs = parsedAttrs !== null && Object.keys(parsedAttrs).length > 0
  const showToggle = hasAttrs || cveCount > 1
  const hasManual = s.manual_status === 'vulnerable' || s.manual_status === 'resolved'
  const needsAction = s.is_vulnerable === 1 || hasManual
  const rowClass = s.manual_status === 'vulnerable'
    ? 'bg-red-lt'
    : s.manual_status === 'resolved'
    ? 'bg-teal-lt'
    : s.is_vulnerable === 1
    ? 'bg-red-lt'
    : ''

  const statusKey =
    s.is_vulnerable === 1
      ? '0'
      : s.manual_status === 'vulnerable'
      ? '1'
      : s.manual_status === 'resolved'
      ? '2'
      : '3'

  return (
    <>
      <tr
        class={rowClass}
        data-row="main"
        data-id={String(s.id)}
        data-status={statusKey}
        data-vendor={(s.vendor ?? '').toLowerCase()}
        data-product={(s.product ?? '').toLowerCase()}
        data-category={categoryDisplayName(s.category).toLowerCase()}
        data-group={(s.group_company ?? '').toLowerCase()}
        data-owner={(s.owner ?? '').toLowerCase()}
        data-manager={(s.manager ?? '').toLowerCase()}
      >
        <td>
          {showToggle ? (
            <button
              type="button"
              class="btn btn-sm btn-icon btn-ghost-secondary"
              data-toggle-cves={String(s.id)}
              aria-expanded="false"
              aria-label="속성/CVE 펼치기"
            >
              <i class="ti ti-chevron-down"></i>
            </button>
          ) : (
            <span class="text-muted">—</span>
          )}
        </td>
        <td>
          <ComponentStatusCell solution={s} cveCount={cveCount} latestCveId={latest?.cve_id ?? null} />
        </td>
        <td><span class="vm-cell-vp" title={s.vendor}><strong>{s.vendor}</strong></span></td>
        <td><span class="vm-cell-vp" title={s.product}>{s.product}</span></td>
        <td>
          <a
            href={`/solutions?category=${encodeURIComponent(s.category)}`}
            class="badge bg-blue-lt text-decoration-none vm-cat"
            title={categoryDisplayName(s.category)}
          >
            {categoryDisplayName(s.category)}
          </a>
        </td>
        <td><code>{s.current_version}</code></td>
        <td>
          {s.group_company ? (
            <span class="badge bg-purple-lt">{s.group_company}</span>
          ) : (
            <span class="text-muted">—</span>
          )}
        </td>
        <td class="text-muted">{s.hostname ?? '—'}</td>
        <td class="text-muted">{s.owner ?? '—'}</td>
        <td class="text-muted">{s.manager ?? '—'}</td>
        <td class="text-end">
          <div class="btn-list flex-nowrap">
            <button
              type="button"
              class="btn btn-sm btn-icon"
              data-bs-toggle="modal"
              data-bs-target="#solution-modal"
              data-mode="edit"
              data-id={String(s.id)}
              data-vendor={s.vendor}
              data-product={s.product}
              data-category={s.category}
              data-current-version={s.current_version}
              data-hostname={s.hostname ?? ''}
              data-owner={s.owner ?? ''}
              data-manager={s.manager ?? ''}
              data-notes={s.notes ?? ''}
              data-group-company={s.group_company ?? ''}
              data-cpe-part={s.cpe_part ?? ''}
              data-cpe-version-range={s.cpe_version_range ?? ''}
              data-aliases={formatAliasesAttr(s.aliases)}
              data-cpe-uri={s.cpe_uri ?? ''}
              data-category-attributes={s.category_attributes ?? ''}
              data-asset-id={s.asset_id !== null ? String(s.asset_id) : ''}
              aria-label="수정"
            >
              <i class="ti ti-edit"></i>
            </button>
            <form
              method="post"
              action={`/solutions/${s.id}/delete`}
              class="d-inline"
              onsubmit={`return confirm('${s.vendor} ${s.product} 를 삭제하시겠습니까?');`}
            >
              <button type="submit" class="btn btn-sm btn-icon text-danger" aria-label="삭제">
                <i class="ti ti-trash"></i>
              </button>
            </form>
            {/* 수동 상태 액션 드롭다운 */}
            <VulnStatusDropdown solution={s} needsAction={needsAction} />
          </div>
        </td>
      </tr>
      {showToggle ? (
        <tr id={`solcves-${s.id}`} data-row="detail" class="d-none">
          <td colspan={11} class={s.is_vulnerable === 1 || s.manual_status === 'vulnerable' ? 'bg-red-lt' : 'bg-light'}>
            <div class="p-2">
              {hasAttrs ? <AttrCard category={s.category} attrs={parsedAttrs!} /> : null}
              {cveCount > 0 ? (
                <div class="card">
                  <div class="card-body p-2">
                    <div class="small text-muted mb-2">감지된 CVE {cveCount}건 (최근순)</div>
                    <div class="table-responsive">
                      <table class="table table-sm mb-0">
                        <thead>
                          <tr>
                            <th>CVE</th>
                            <th>심각도</th>
                            <th>출처</th>
                            <th>공개</th>
                            <th>감지</th>
                            <th>제목</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matches.map((m) => (
                            <tr>
                              <td>
                                {m.url ? (
                                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                                    {m.cve_id ?? '—'}
                                  </a>
                                ) : (
                                  m.cve_id ?? '—'
                                )}
                              </td>
                              <td><SeverityBadge severity={m.severity} /></td>
                              <td><span class="badge bg-secondary-lt">{m.source ?? '—'}</span></td>
                              <td class="text-muted small">{m.published ?? '—'}</td>
                              <td class="text-muted small">{formatDate(m.detected_at)}</td>
                              <td class="text-truncate" style="max-width:28rem">{m.title ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ============================================================
// 수동 상태 표시 셀 (SolutionRow · AssetComponentRow 공통)
// ============================================================
function ComponentStatusCell(props: {
  solution: Solution
  cveCount: number
  latestCveId: string | null
}) {
  const s = props.solution
  const { cveCount, latestCveId } = props

  // 수동 취약 (amber — 수동 플래그)
  if (s.manual_status === 'vulnerable') {
    return (
      <div class="vm-status">
        <span class="vm-pill vm-pill--manual" title={s.status_note ?? '수동 취약 표시됨'}>
          <i class="ti ti-flag"></i>수동취약
        </span>
        {s.status_note ? (
          <span class="vm-note" title={s.status_note}>{s.status_note}</span>
        ) : null}
      </div>
    )
  }

  // 수동 조치완료 (teal)
  if (s.manual_status === 'resolved') {
    return (
      <div class="vm-status">
        <span class="vm-pill vm-pill--resolved" title={s.status_note ?? '조치완료(수동)'}>
          <i class="ti ti-circle-check"></i>조치완료
        </span>
        {s.status_note ? (
          <span class="vm-note" title={s.status_note}>{s.status_note}</span>
        ) : null}
      </div>
    )
  }

  // 자동 취약 (red) — pill 은 '취약' 단어로 콤팩트하게, CVE id 는 아래 note 줄로
  // (CVE id 를 pill 에 넣으면 상태 컬럼을 넘쳐 옆 칸과 겹치므로 분리)
  if (s.is_vulnerable === 1) {
    const cve = latestCveId ?? s.last_matched_cve ?? null
    const note = cve
      ? (cveCount > 1 ? `${cve} · 총 ${cveCount}건` : cve)
      : (cveCount > 1 ? `총 ${cveCount}건` : null)
    return (
      <div class="vm-status">
        <span class="vm-pill vm-pill--vuln" title={cve ?? '취약'}>
          <i class="ti ti-alert-triangle"></i>취약
        </span>
        {note ? <span class="vm-note" title={cve ?? undefined}>{note}</span> : null}
      </div>
    )
  }

  // 정상 (green)
  return (
    <span class="vm-pill vm-pill--ok">
      <i class="ti ti-shield-check"></i>정상
    </span>
  )
}

// ============================================================
// 수동 상태 액션 드롭다운 (SolutionRow · AssetComponentRow 공통)
// ============================================================
function VulnStatusDropdown(props: { solution: Solution; needsAction: boolean }) {
  const s = props.solution
  const hasManual = s.manual_status === 'vulnerable' || s.manual_status === 'resolved'
  const confirmResolveMsg = `${s.vendor} ${s.product} 를 조치완료(해결)로 표시하시겠습니까?`
  const confirmAutoMsg = `${s.vendor} ${s.product} 의 수동 상태를 해제하고 자동(n8n) 상태로 복귀하시겠습니까?`

  return (
    <div class="dropdown d-inline">
      <button
        type="button"
        class="btn btn-sm btn-icon btn-ghost-secondary"
        data-bs-toggle="dropdown"
        aria-expanded="false"
        aria-label="취약점 상태 관리"
        title="취약점 상태 관리"
      >
        <i class="ti ti-shield-bolt"></i>
      </button>
      <div class="dropdown-menu dropdown-menu-end">
        <div class="dropdown-header small text-muted py-1">상태 관리</div>
        {/* 수동 취약 표시 — 항상 노출 */}
        <button
          type="button"
          class="dropdown-item text-danger"
          data-bs-toggle="modal"
          data-bs-target="#vuln-mark-modal"
          data-id={String(s.id)}
          data-vendor={s.vendor}
          data-product={s.product}
        >
          <i class="ti ti-flag me-2"></i>수동 취약 표시
        </button>
        {/* 조치완료 — 취약하거나 수동 상태가 있을 때. 방식(수동/업데이트) 선택 모달로 진입. */}
        {props.needsAction ? (
          <button
            type="button"
            class="dropdown-item text-teal"
            data-bs-toggle="modal"
            data-bs-target="#vuln-resolve-modal"
            data-id={String(s.id)}
            data-vendor={s.vendor}
            data-product={s.product}
          >
            <i class="ti ti-circle-check me-2"></i>조치완료(해결)
          </button>
        ) : null}
        {/* 자동복귀 — 수동 상태가 있을 때만 */}
        {hasManual ? (
          <form
            method="post"
            action={`/solutions/${s.id}/vuln-status`}
            class="d-block"
            onsubmit={`return confirm('${confirmAutoMsg.replace(/'/g, "\\'")}');`}
          >
            <input type="hidden" name="action" value="auto" />
            <button type="submit" class="dropdown-item text-secondary">
              <i class="ti ti-refresh me-2"></i>자동복귀(n8n)
            </button>
          </form>
        ) : null}
      </div>
    </div>
  )
}

// ============================================================
// 수동 취약 표시 모달 (#vuln-mark-modal) — 공유 인스턴스
// ============================================================
function VulnMarkModal() {
  return (
    <div
      class="modal modal-blur fade"
      id="vuln-mark-modal"
      tabindex={-1}
      role="dialog"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header bg-red-lt">
            <h5 class="modal-title text-danger">
              <i class="ti ti-flag me-2"></i>수동 취약 표시
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          {/* action 은 JS 에서 data-id 를 읽어 동적으로 설정 */}
          <form id="vuln-mark-form" method="post" action="/solutions/0/vuln-status">
            <div class="modal-body">
              {/* 대상 컴포넌트 읽기전용 표시 */}
              <div class="mb-3 p-2 bg-light rounded">
                <div class="small text-muted mb-1">대상 컴포넌트</div>
                <div id="vuln-mark-target" class="fw-bold">—</div>
              </div>
              <input type="hidden" name="action" value="vulnerable" />
              <div class="row g-3">
                <div class="col-12">
                  <label class="form-label">CVE ID <small class="text-muted">(선택)</small></label>
                  <input
                    type="text"
                    name="cve_id"
                    class="form-control"
                    placeholder="예: CVE-2024-12345 (미입력 시 자동 부여)"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">심각도 <small class="text-muted">(선택)</small></label>
                  <select name="severity" class="form-select">
                    <option value="">(선택)</option>
                    <option value="critical">critical</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                </div>
                <div class="col-12">
                  <label class="form-label">취약점 제목 <small class="text-muted">(선택)</small></label>
                  <input
                    type="text"
                    name="title"
                    class="form-control"
                    placeholder="예: 수동 확인된 취약점 요약"
                  />
                </div>
                <div class="col-12">
                  <label class="form-label">메모 <small class="text-muted">(선택)</small></label>
                  <textarea
                    name="note"
                    class="form-control"
                    rows={3}
                    placeholder="예: 검출 근거/조치 계획"
                  ></textarea>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn btn-danger">
                <i class="ti ti-flag me-1"></i>취약으로 표시
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 조치완료 모달 (#vuln-resolve-modal) — 방식(수동/업데이트) 선택 + 메모
// ============================================================
function VulnResolveModal() {
  return (
    <div
      class="modal modal-blur fade"
      id="vuln-resolve-modal"
      tabindex={-1}
      role="dialog"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header" style="background:var(--vm-resolved-bg)">
            <h5 class="modal-title" style="color:var(--vm-resolved-fg)">
              <i class="ti ti-circle-check me-2"></i>조치완료 처리
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          {/* action 은 JS 가 data-id 로 동적 설정 */}
          <form id="vuln-resolve-form" method="post" action="/solutions/0/vuln-status">
            <div class="modal-body">
              <div class="mb-3 p-2 bg-light rounded">
                <div class="small text-muted mb-1">대상 컴포넌트</div>
                <div id="vuln-resolve-target" class="fw-bold">—</div>
              </div>
              <input type="hidden" name="action" value="resolved" />
              <div class="row g-3">
                <div class="col-12">
                  <label class="form-label required">조치 방식</label>
                  <select name="method" class="form-select" required>
                    <option value="manual">수동 조치 (설정 변경·우회 등)</option>
                    <option value="update">버전 업데이트 (패치 적용)</option>
                  </select>
                  <small class="form-hint">조치 이력 화면에서 방식별로 구분되어 표시됩니다.</small>
                </div>
                <div class="col-12">
                  <label class="form-label">메모 <small class="text-muted">(선택)</small></label>
                  <textarea
                    name="note"
                    class="form-control"
                    rows={3}
                    placeholder="예: 7.4.1 → 7.4.4 패치 적용 / KISA 권고 설정 변경"
                  ></textarea>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn" style="background:var(--vm-resolved-fg);color:#fff">
                <i class="ti ti-circle-check me-1"></i>조치완료 처리
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 속성 카드 (카테고리별 category_attributes 파싱 표시)
// ============================================================
function AttrCard(props: { category: string; attrs: Record<string, unknown> }) {
  const meta = CATEGORY_METADATA[props.category]
  const labelOf = (k: string): string => {
    if (!meta) return k
    const found = meta.attrs.find((a) => a.key === k)
    return found ? found.label : k
  }
  const entries = Object.entries(props.attrs)
  return (
    <div class="card mb-2">
      <div class="card-body p-2">
        <div class="small text-muted mb-2">
          <i class="ti ti-tag me-1"></i>속성 ({categoryDisplayName(props.category)})
        </div>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <tbody>
              {entries.map(([k, v]) => (
                <tr>
                  <td class="text-muted" style="width:30%">{labelOf(k)}</td>
                  <td><code>{String(v)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 심각도 배지
// ============================================================
function SeverityBadge(props: { severity: string | null }) {
  if (!props.severity) {
    return <span class="badge bg-secondary-lt">N/A</span>
  }
  const sev = props.severity.toLowerCase()
  const classMap: Record<string, string> = {
    critical: 'bg-red text-white',
    high: 'bg-orange text-white',
    medium: 'bg-yellow',
    low: 'bg-azure-lt',
  }
  const cls = classMap[sev] ?? 'bg-secondary-lt'
  return <span class={`badge ${cls}`}>{props.severity}</span>
}

// ============================================================
// Flash 알림
// ============================================================
function FlashAlert(props: { flash: FlashMessage }) {
  const cls = props.flash.type === 'success' ? 'alert-success' : 'alert-danger'
  const icon = props.flash.type === 'success' ? 'circle-check' : 'alert-circle'
  return (
    <div class={`alert ${cls} alert-dismissible mb-3`} role="alert">
      <div class="d-flex">
        <div><i class={`ti ti-${icon} me-2`}></i></div>
        <div>{props.flash.message}</div>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="닫기"></button>
    </div>
  )
}

// ============================================================
// CSV 일괄 등록 모달
// ============================================================
function BulkUploadModal() {
  return (
    <div
      class="modal modal-blur fade"
      id="bulk-modal"
      tabindex={-1}
      role="dialog"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">CSV 일괄 등록</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <form id="bulk-form">
            <div class="modal-body">
              <div class="alert alert-info">
                <strong>한 행 = 한 장비</strong>입니다. 한 장비의 OS / 펌웨어 / DB / OpenSSL / WEB / WAS 버전을
                한 줄에 입력하면 시스템이 자동으로 분해해 각각의 솔루션 행으로 등록합니다.
                <br />
                <strong>필수 헤더</strong>:{' '}
                <code>vendor, model, hostname, os_version</code>
                <br />
                <strong>선택 헤더</strong>:{' '}
                <code>hw_version, db_engine, db_version, openssl_version, web_engine, web_version, was_engine, was_version, group_company, owner(부서), manager(담당자), notes</code>
                <br />
                <small class="text-muted">엔진 select 값 예시 — DB: MySQL/PostgreSQL/Oracle/MSSQL · WEB: Apache/Nginx/IIS · WAS: Tomcat/JBoss/WebLogic/WebSphere/JEUS</small>
                <br />
                <a href="/static/bulk_solutions_template.csv" download="bulk_solutions_template.csv">
                  <i class="ti ti-download me-1"></i>샘플 CSV 다운로드
                </a>
              </div>
              <div class="mb-3">
                <label class="form-label required">CSV 파일</label>
                <input
                  type="file"
                  id="bulk-file"
                  name="file"
                  accept=".csv,text/csv"
                  class="form-control"
                  required
                />
                <small class="text-muted">최대 500행. UTF-8 인코딩 권장.</small>
              </div>
              <div id="bulk-status"></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                닫기
              </button>
              <button type="submit" id="bulk-submit-btn" class="btn btn-primary">
                <i class="ti ti-upload me-1"></i>업로드
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 장비 등록 모달 (기존 #asset-modal 유지 — 구성요소 추가 prefill 겸용)
// ============================================================
function NewAssetModal(props: {
  groupSuggestions: string[]
  userGroups: string[]
  isAdmin: boolean
  activeGroup: string | null
}) {
  // v3.6 신규 장비는 현재 진입한 활성 그룹사로 자동 등록 — 수동 그룹사 입력 제거.
  //   activeGroup 이 없으면(admin '전체') 등록 불가 안내.
  const canRegister = props.activeGroup !== null
  return (
    <div
      class="modal modal-blur fade"
      id="asset-modal"
      tabindex={-1}
      role="dialog"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="ti ti-server-2 me-2"></i>장비 등록
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <form id="asset-form">
            <div class="modal-body" style="max-height: calc(100vh - 200px); overflow-y: auto;">
              <div class="alert alert-success">
                <strong>한 장비를 등록합니다.</strong> 벤더 / 장비모델 / Hostname / OS 버전은 필수,
                나머지(HW 펌웨어, DB, OpenSSL, WEB, WAS)는 운영 중인 항목만 입력하면 됩니다.
                매칭에 필요한 CPE/별칭은 시스템이 자동으로 추천합니다.
              </div>

              {/* 필수 4개 */}
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label required">벤더</label>
                  <input
                    type="text"
                    id="asset-vendor"
                    class="form-control"
                    required
                    placeholder="예: Fortinet / Microsoft / Canonical"
                  />
                  <small class="text-muted">제조사. OS 자동 매핑에 사용됨.</small>
                </div>
                <div class="col-md-6">
                  <label class="form-label required">장비모델</label>
                  <input
                    type="text"
                    id="asset-model"
                    class="form-control"
                    required
                    placeholder="예: FortiGate-100F / Windows Server / Ubuntu 22.04"
                  />
                  <small class="text-muted">제품명. HW 펌웨어 등록 시 제품으로도 사용됨.</small>
                </div>
                <div class="col-md-6">
                  <label class="form-label required">Hostname</label>
                  <input
                    type="text"
                    id="asset-hostname"
                    class="form-control"
                    required
                    placeholder="예: fw-hq-01 / srv-app-prod-02"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label required">OS / 펌웨어 버전</label>
                  <input
                    type="text"
                    id="asset-os-version"
                    class="form-control"
                    required
                    placeholder="예: 7.4.1 / 22.04 / 2022"
                  />
                </div>
              </div>

              {/* 선택 컴포넌트 */}
              <div class="hr-text hr-text-left mt-3">
                <i class="ti ti-list-details me-1"></i>추가 컴포넌트 (필요한 항목만 — 빈 행은 자동 무시)
              </div>

              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">HW 펌웨어 버전</label>
                  <input
                    type="text"
                    id="asset-hw-version"
                    class="form-control"
                    placeholder="예: 1.2.3 (장비모델을 HW 제품으로 사용)"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">OpenSSL 버전</label>
                  <input
                    type="text"
                    id="asset-openssl-version"
                    class="form-control"
                    placeholder="예: 1.1.1k / 3.0.5"
                  />
                </div>

                <div class="col-md-3">
                  <label class="form-label">DB 엔진</label>
                  <select id="asset-db-engine" class="form-select">
                    <option value="">(선택)</option>
                    {DB_ENGINES.map((e) => (<option value={e}>{e}</option>))}
                  </select>
                </div>
                <div class="col-md-3">
                  <label class="form-label">DB 버전</label>
                  <input type="text" id="asset-db-version" class="form-control" placeholder="예: 8.0.36" />
                </div>

                <div class="col-md-3">
                  <label class="form-label">WEB 엔진</label>
                  <select id="asset-web-engine" class="form-select">
                    <option value="">(선택)</option>
                    {WEB_ENGINES.map((e) => (<option value={e}>{e}</option>))}
                  </select>
                </div>
                <div class="col-md-3">
                  <label class="form-label">WEB 버전</label>
                  <input type="text" id="asset-web-version" class="form-control" placeholder="예: 2.4.58" />
                </div>

                <div class="col-md-3">
                  <label class="form-label">WAS 엔진</label>
                  <select id="asset-was-engine" class="form-select">
                    <option value="">(선택)</option>
                    {WAS_ENGINES.map((e) => (<option value={e}>{e}</option>))}
                  </select>
                </div>
                <div class="col-md-3">
                  <label class="form-label">WAS 버전</label>
                  <input type="text" id="asset-was-version" class="form-control" placeholder="예: 9.0.85" />
                </div>
              </div>

              {/* 추가 컴포넌트 (동적 행) */}
              <div class="hr-text hr-text-left mt-3">
                <i class="ti ti-puzzle me-1"></i>추가 컴포넌트 (OpenSSH · Docker · Redis 등 사전 슬롯 외)
              </div>
              <div class="table-responsive">
                <table class="table table-sm table-vcenter mb-0" id="extra-components-table">
                  <thead>
                    <tr>
                      <th style="width:25%">카테고리</th>
                      <th style="width:45%">제품</th>
                      <th style="width:25%">버전</th>
                      <th class="w-1"></th>
                    </tr>
                  </thead>
                  <tbody id="extra-components-body">
                    {/* 초기 행 0개 */}
                  </tbody>
                </table>
              </div>
              <div class="mt-2">
                <button
                  type="button"
                  id="extra-add-row-btn"
                  class="btn btn-sm btn-outline-primary"
                  title="예: OpenSSH 9.6 / Docker 24.0.7 / Redis 7.2.4"
                >
                  <i class="ti ti-plus me-1"></i>다른 컴포넌트 추가 (예: OpenSSH, Docker, Redis)
                </button>
                <small class="text-muted ms-2">
                  사전 슬롯(HW/DB/OpenSSL/WEB/WAS)에 없는 항목을 자유롭게 추가할 수 있습니다.
                </small>
              </div>

              {/* 자산 메타 */}
              <div class="hr-text hr-text-left mt-3">
                <i class="ti ti-building me-1"></i>자산 메타 (선택)
              </div>

              {/* v3.6 그룹사: 현재 진입한 활성 그룹사로 자동 등록 (수동 입력 제거) */}
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">그룹사</label>
                  {canRegister ? (
                    <div class="form-control-plaintext py-1">
                      <span class="badge bg-blue-lt">
                        <i class="ti ti-building me-1"></i>{props.activeGroup}
                      </span>
                      <span class="text-muted ms-2 small">현재 진입한 그룹사로 등록됩니다</span>
                    </div>
                  ) : (
                    <div class="text-warning small py-1">
                      <i class="ti ti-alert-triangle me-1"></i>전체 보기 상태입니다. 특정 그룹사로 진입한 뒤 등록하세요.
                    </div>
                  )}
                </div>
                <div class="col-md-3">
                  <label class="form-label">부서</label>
                  <input type="text" id="asset-owner" class="form-control" placeholder="예: 인프라팀 / 보안팀" />
                </div>
                <div class="col-md-3">
                  <label class="form-label">담당자</label>
                  <input type="text" id="asset-manager" class="form-control" placeholder="예: 홍길동" />
                </div>
              </div>

              <div id="asset-status" class="mt-3"></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button
                type="submit"
                id="asset-submit-btn"
                class="btn btn-success"
                disabled={!canRegister}
                title={canRegister ? '' : '특정 그룹사로 진입한 뒤 등록할 수 있습니다'}
              >
                <i class="ti ti-check me-1"></i>장비 등록
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 솔루션(구성요소) 단건 등록/수정 모달
// ============================================================
function SolutionModal(props: {
  groupSuggestions: string[]
  userGroups: string[]
  isAdmin: boolean
  assetOptions: AssetOption[]
  activeGroup: string | null
}) {
  // 현재 활성 그룹과 일치하는 자산 옵션 우선 노출 (같은 그룹이 없으면 전체)
  const filteredOptions = props.activeGroup
    ? props.assetOptions.filter((a) => a.group_company === props.activeGroup)
    : props.assetOptions

  return (
    <div
      class="modal modal-blur fade"
      id="solution-modal"
      tabindex={-1}
      role="dialog"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="modal-title">새 솔루션 등록</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <form id="solution-form" method="post" action="/solutions">
            <div class="modal-body" style="max-height: calc(100vh - 200px); overflow-y: auto;">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label required">벤더</label>
                  <input
                    type="text"
                    name="vendor"
                    class="form-control"
                    required
                    placeholder="예: Fortinet / Microsoft / OpenSSL"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label required">제품</label>
                  <input
                    type="text"
                    name="product"
                    class="form-control"
                    required
                    placeholder="예: FortiOS / Windows Server / OpenSSL"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label required">카테고리</label>
                  <select name="category" class="form-select" required>
                    <option value="">선택</option>
                    {CATEGORY_KEYS.map((key) => (
                      <option value={key}>{CATEGORY_METADATA[key].displayName}</option>
                    ))}
                  </select>
                  <small class="text-muted">
                    선택한 카테고리에 맞게 아래 입력 항목이 자동으로 바뀝니다.
                  </small>
                </div>
                <div class="col-md-6">
                  <label class="form-label required" id="current-version-label">현재 버전</label>
                  <input
                    type="text"
                    name="current_version"
                    class="form-control"
                    required
                    placeholder="예: 1.0.0"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label required">그룹사</label>
                  {props.isAdmin ? (
                    <input
                      type="text"
                      name="group_company"
                      class="form-control"
                      list="group-company-list"
                      placeholder="예: 본사, OO계열, 자회사A (admin 자유 입력)"
                    />
                  ) : props.userGroups.length === 1 ? (
                    <input
                      type="text"
                      name="group_company"
                      class="form-control"
                      value={props.userGroups[0]}
                      readonly
                    />
                  ) : props.userGroups.length > 1 ? (
                    <select name="group_company" class="form-select">
                      {props.userGroups.map((g) => (
                        <option value={g}>{g}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      name="group_company"
                      class="form-control"
                      placeholder="담당 그룹사가 없습니다 — 관리자에게 문의"
                      readonly
                    />
                  )}
                  <datalist id="group-company-list">
                    {props.groupSuggestions.map((name) => (
                      <option value={name}></option>
                    ))}
                  </datalist>
                  <small class="text-muted">본인이 담당하는 그룹사만 선택 가능합니다.</small>
                </div>
                <div class="col-md-6">
                  <label class="form-label">호스트명</label>
                  <input
                    type="text"
                    name="hostname"
                    class="form-control"
                    placeholder="예: fw-hq-01 / srv-app-02"
                  />
                </div>
                <div class="col-md-3">
                  <label class="form-label">부서</label>
                  <input type="text" name="owner" class="form-control" placeholder="예: 보안팀" />
                </div>
                <div class="col-md-3">
                  <label class="form-label">담당자</label>
                  <input type="text" name="manager" class="form-control" placeholder="예: 홍길동" />
                </div>
                <div class="col-12">
                  <label class="form-label">비고</label>
                  <textarea name="notes" class="form-control" rows={2}></textarea>
                </div>

                {/* 기존 솔루션(자산)에 추가 드롭다운 — 생성 모드에서만 표시 */}
                <div class="col-12" id="asset-select-wrap">
                  <label class="form-label">솔루션(자산) 연결</label>
                  <select name="asset_id" class="form-select">
                    <option value="">새 솔루션으로 (단독 등록)</option>
                    {filteredOptions.map((a) => (
                      <option value={String(a.id)}>
                        {a.name}{a.group_company ? ` (${a.group_company})` : ''}
                      </option>
                    ))}
                    {/* 활성 그룹 필터 중이고 다른 그룹 옵션도 있을 때 구분선 */}
                    {props.activeGroup && props.assetOptions.length > filteredOptions.length ? (
                      <>
                        <option disabled>──── 다른 그룹사 ────</option>
                        {props.assetOptions
                          .filter((a) => a.group_company !== props.activeGroup)
                          .map((a) => (
                            <option value={String(a.id)}>
                              {a.name}{a.group_company ? ` (${a.group_company})` : ''}
                            </option>
                          ))}
                      </>
                    ) : null}
                  </select>
                  <small class="text-muted">
                    기존 솔루션(자산)에 이 구성요소를 추가하거나, 비워두면 새 자산으로 단독 등록됩니다.
                  </small>
                  {/* 수정 모드에서 asset_id 전달용 hidden */}
                  <input type="hidden" id="solution-asset-id" name="asset_id_edit" value="" />
                </div>

                {/* 고급 설정 아코디언 — CPE/별칭 수동 보정 */}
                <div class="col-12">
                  <div class="accordion" id="advanced-accordion">
                    <div class="accordion-item">
                      <h2 class="accordion-header">
                        <button
                          class="accordion-button collapsed"
                          type="button"
                          data-bs-toggle="collapse"
                          data-bs-target="#advanced-collapse"
                          aria-expanded="false"
                          aria-controls="advanced-collapse"
                        >
                          <i class="ti ti-shield-cog me-2"></i>매칭 담당자용 — CPE/별칭 수동 보정
                          <span class="text-muted ms-2 small">(운영자는 무시 — 자동 처리됨)</span>
                        </button>
                      </h2>
                      <div
                        id="advanced-collapse"
                        class="accordion-collapse collapse"
                        data-bs-parent="#advanced-accordion"
                      >
                        <div class="accordion-body">
                          <div class="row g-3">
                            <div class="col-md-8">
                              <label class="form-label">CPE part</label>
                              <div class="input-group">
                                <input
                                  type="text"
                                  name="cpe_part"
                                  class="form-control font-monospace"
                                  placeholder="예: cpe:2.3:a:fortinet:fortigate"
                                />
                                <button
                                  type="button"
                                  id="cpe-lookup-btn"
                                  class="btn btn-outline-primary"
                                  title="NVD CPE 검색"
                                >
                                  <i class="ti ti-search"></i>
                                </button>
                              </div>
                              <small class="text-muted" id="cpe-status"></small>
                              <div
                                id="cpe-suggestions"
                                class="list-group list-group-flush mt-1"
                                style="max-height: 180px; overflow-y: auto;"
                              ></div>
                            </div>
                            <div class="col-md-4">
                              <label class="form-label">버전 범위</label>
                              <input
                                type="text"
                                name="cpe_version_range"
                                class="form-control font-monospace"
                                placeholder="예: >=7.0.0,<7.0.16"
                              />
                              <small class="text-muted">매칭 정확도 향상용</small>
                            </div>
                            <div class="col-12">
                              <label class="form-label">CPE URI (전체)</label>
                              <input
                                type="text"
                                name="cpe_uri"
                                class="form-control font-monospace"
                                placeholder="예: cpe:2.3:a:openssl:openssl:1.1.1k:*:*:*:*:*:*:*"
                              />
                              <small class="text-muted">
                                NVD CVE 매칭 정확도를 가장 크게 좌우하는 식별자.
                              </small>
                            </div>
                            <div class="col-12">
                              <label class="form-label">Aliases (쉼표 구분)</label>
                              <input
                                type="text"
                                name="aliases"
                                class="form-control"
                                placeholder="예: FortiGate-VM, 방화벽, fortigate, NGFW"
                              />
                              <small class="text-muted">
                                한↔영 표기 변형이나 사내 자산 라벨을 적어두면 매칭 누락을 막을 수 있습니다.
                              </small>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" id="submit-btn" class="btn btn-primary">등록</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 유틸리티 함수
// ============================================================
function formatDate(raw: string | null): string | null {
  if (!raw) return null
  return raw.replace('T', ' ').replace('Z', '').slice(0, 19)
}

function formatAliasesAttr(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => typeof s === 'string').join(', ')
    }
  } catch {
    // fall through
  }
  return raw
}

function parseAttrsJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
