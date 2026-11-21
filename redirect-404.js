/**
 * GitHub Pages 깊은 하위 경로 404 진입 시 무한 리다이렉트 없이 저장소 루트(./ 또는 /<repo>/)로 복귀
 */
(function redirectToAppBase() {
  const segs = window.location.pathname.split('/').filter(Boolean);
  const target = window.location.hostname.endsWith('.github.io') && segs.length > 0
    ? '/' + segs[0] + '/'
    : '/';
  if (window.location.pathname !== target) {
    window.location.replace(target);
  }
})();
