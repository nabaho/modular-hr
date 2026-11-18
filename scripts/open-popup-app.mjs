/**
 * 전용 로컬 도메인(http://modular-hr.localhost:4330) 서버 자동 기동 및
 * 주소창 없는 OS 독립 프로그램 팝업창(App Mode Window) 실행기
 * - 외부 인터넷 노출 없이 127.0.0.1 / ::1 루프백에서만 동작한다.
 * - 셸 문자열 보간 없이 고정 실행파일 경로와 배열 인자(shell: false)만 사용한다.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 4330;
const rawPort = Number(process.env.PORT || DEFAULT_PORT);
const PORT = Number.isInteger(rawPort) && rawPort >= 1024 && rawPort <= 65535 ? rawPort : DEFAULT_PORT;
const POPUP_URL = `http://modular-hr.localhost:${PORT}/?popup=1&autounlock=1`;
const MOBILE_POPUP_URL = `http://modular-hr.localhost:${PORT}/mobile.html`;

function findInstalledChromiumBinary() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function isServerHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/mobile/bootstrap`);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureLocalDomainServer(port, explicitDemo = false) {
  if (await isServerHealthy(port)) {
    return { alreadyRunning: true };
  }

  const nextEnv = {
    ...process.env,
    PORT: String(port),
  };
  // 기본값은 보안 모드(demo 비활성)를 유지하며, 명시적 --demo 플래그 또는 MHR_DEMO_MODE=1 지정 시에만 시뮬레이터 체험 모드를 켠다.
  if (explicitDemo && nextEnv.MHR_DEMO_MODE === undefined) {
    nextEnv.MHR_DEMO_MODE = '1';
  }

  const serverScript = path.join(PROJECT_ROOT, 'src', 'server.mjs');
  const child = spawn(process.execPath, [serverScript], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    env: nextEnv,
  });
  child.unref();

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isServerHealthy(port)) {
      return { alreadyRunning: false };
    }
  }
  throw new Error(`전용 로컬 서버(포트 ${port}) 기동 확인에 실패했습니다.`);
}

async function main() {
  const launchMobileToo = process.argv.includes('--with-mobile');
  const dryRun = process.argv.includes('--check-only');
  const explicitDemo = process.argv.includes('--demo');
  const targetPopupUrl =
    explicitDemo || process.env.MHR_DEMO_MODE === '1'
      ? POPUP_URL
      : `http://modular-hr.localhost:${PORT}/?popup=1`;

  const srvState = await ensureLocalDomainServer(PORT, explicitDemo);
  console.log(
    `[popup-launcher] 전용 로컬 도메인 준비 완료 (${srvState.alreadyRunning ? '기존 서버 연결' : '신규 기동'}): ${targetPopupUrl}`
  );

  if (dryRun) return;

  const browserBin = findInstalledChromiumBinary();
  if (!browserBin) {
    console.log(`[popup-launcher] Chrome/Edge 실행파일을 찾지 못했습니다. 브라우저에서 ${targetPopupUrl} 를 열어 주세요.`);
    return;
  }

  const profileDir = path.join(os.tmpdir(), `modular-hr-app-popup-${PORT}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const commonResolverRule =
    '--host-resolver-rules=MAP modular-hr.localhost 127.0.0.1, MAP pureun-hr.localhost 127.0.0.1';

  const mainPopup = spawn(
    browserBin,
    [
      `--user-data-dir=${profileDir}`,
      commonResolverRule,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1420,920',
      '--window-position=50,35',
      `--app=${targetPopupUrl}`,
    ],
    {
      detached: true,
      stdio: 'ignore',
      shell: false,
    }
  );
  mainPopup.unref();
  console.log(`[popup-launcher] 주소창 없는 독립 대시보드 팝업창 실행됨: ${targetPopupUrl}`);

  if (launchMobileToo) {
    const mobileProfileDir = path.join(os.tmpdir(), `modular-hr-mobile-popup-${PORT}`);
    fs.mkdirSync(mobileProfileDir, { recursive: true });
    const mobilePopup = spawn(
      browserBin,
      [
        `--user-data-dir=${mobileProfileDir}`,
        commonResolverRule,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=430,880',
        '--window-position=1020,55',
        `--app=${MOBILE_POPUP_URL}`,
      ],
      {
        detached: true,
        stdio: 'ignore',
        shell: false,
      }
    );
    mobilePopup.unref();
    console.log(`[popup-launcher] 모바일 폰 앱 독립 팝업창 실행됨: ${MOBILE_POPUP_URL}`);
  }
}

main().catch((err) => {
  console.error('[popup-launcher] 오류:', err.message);
  process.exitCode = 1;
});
