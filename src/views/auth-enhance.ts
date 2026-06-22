// v2.8 로그인/계정 비밀번호 입력 UX 보강 스크립트.
// - login.tsx, account.tsx 공용 인라인 스크립트(외부 의존성 없음).
// - 비밀번호 표시 토글(눈 아이콘) + Caps Lock 경고 표시.
// 주입: <script dangerouslySetInnerHTML={{ __html: AUTH_FORM_SCRIPT }} /> 형태로 1회.

// 순수 JS 문자열(IIFE). hono/jsx 의 dangerouslySetInnerHTML 로 그대로 삽입된다.
export const AUTH_FORM_SCRIPT: string = `(function () {
  function setup() {
    // 1) 비밀번호 표시 토글
    document.querySelectorAll('a.js-pw-toggle').forEach(function (toggle) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        var selector = toggle.getAttribute('data-target');
        if (!selector) return;
        // 클릭 시점에 조회 — type 이 바뀌어도 동작.
        var input = document.querySelector(selector);
        if (!input) return;
        var isPassword = input.getAttribute('type') === 'password';
        input.setAttribute('type', isPassword ? 'text' : 'password');
        var icon = toggle.querySelector('i');
        if (icon) {
          if (isPassword) {
            icon.classList.remove('ti-eye');
            icon.classList.add('ti-eye-off');
          } else {
            icon.classList.remove('ti-eye-off');
            icon.classList.add('ti-eye');
          }
        }
      });
    });

    // 2) Caps Lock 경고
    function handleCapsLock(e) {
      var input = e.currentTarget;
      var form = input.closest('form');
      if (!form) return;
      var warning = form.querySelector('.js-capslock');
      if (!warning) return;
      var capsOn = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
      if (capsOn) {
        warning.classList.remove('d-none');
      } else {
        warning.classList.add('d-none');
      }
    }
    document.querySelectorAll('input[type=password]').forEach(function (input) {
      input.addEventListener('keydown', handleCapsLock);
      input.addEventListener('keyup', handleCapsLock);
    });
  }

  // DOMContentLoaded 이후 안전 동작.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();`
