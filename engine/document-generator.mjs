/**
 * 규모·업종별 자동 생성 규정 · 관공서 신고서 · 정기회의록 작성 보조 초안 생성 엔진
 * - 모든 산출물은 실제 사실관계 기입·검토·서명 전의 「작성 보조용 표준 초안(양식)」으로 제공된다.
 */

import { INDUSTRIES } from './labor-rules.mjs?v=ded2c66c4e77';

export const VALID_DOC_TEMPLATES = Object.freeze([
  'DOC_LMC_REGULATION_AND_FILING',
  'DOC_LMC_MINUTES',
  'DOC_OSH_OFFICER_APPOINTMENT',
  'DOC_OSH_MINUTES',
  'DOC_WORK_RULES_REPORT',
  'DOC_EMPLOYMENT_CONTRACT',
  'DOC_PRIVACY_CONSENT',
  'DOC_NDA_SECURITY_PLEDGE',
  'DOC_EXIT_SECURITY_NONCOMPETE',
  'DOC_CAREER_CERTIFICATE',
  'DOC_EI_SEPARATION_CERT',
  'DOC_EMPLOYMENT_CERT',
  'DOC_ANNUAL_LEAVE_PROMOTION',
  'DOC_DISCIPLINE_WRITTEN_NOTICE',
]);

function safeText(v, fallback = '-') {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : fallback;
}

const QUARTER_MONTH_HINT = Object.freeze({
  1: '03',
  2: '06',
  3: '09',
  4: '12',
});

export function generateStatutoryDocument(templateId, context = {}) {
  const doc = buildStatutoryDocumentInternal(templateId, context);
  return {
    ...doc,
    legalBasis: doc.legalBasis || doc.subtitle || '',
  };
}

function buildStatutoryDocumentInternal(templateId, context = {}) {
  const companyName = safeText(context.companyName, '주식회사 푸른테크');
  const bizRegNo = safeText(context.bizRegNo, '123-81-00000');
  const industry = INDUSTRIES[context.ksicMajor] || INDUSTRIES.C;
  const lsaCount = Number(context.lsaRegularCount ?? 30);
  const oshCount = Number(context.oshRegularCount ?? lsaCount);
  const triggerDate = safeText(context.triggerDate, '2026-11-10');
  const referenceDate = safeText(context.referenceDate, '2026-11-15');
  const dueDate = safeText(context.dueDate, '2026-11-25');
  const hasUnion = context.hasMajorityUnion === true;
  const pol = context.policySettings || {};
  const payDayLabel = safeText(pol.payDayLabel, '매월 25일');
  const isFiscalLeave = pol.leaveAccrualBasis === 'FISCAL_YEAR';
  const fyStartLabel = safeText(pol.fiscalYearStartMonthDay, '01-01');
  const leavePolicySummary = isFiscalLeave
    ? `회계연도 일괄 기준 (매년 ${fyStartLabel} 부여 · 퇴직 시 입사일 기준과 비교해 유리한 조건 정산)`
    : '개별 입사일 기준 부여 (근로기준법 제60조 원칙)';

  const refYear = /^\d{4}/.test(referenceDate) ? Number(referenceDate.slice(0, 4)) : 2026;
  const refMonth = /^\d{4}-(\d{2})/.test(referenceDate) ? Number(referenceDate.slice(5, 7)) : 11;
  const defaultQuarter = Math.min(4, Math.max(1, Math.ceil(refMonth / 3)));
  const quarterNum =
    Number.isInteger(Number(context.quarterNumber)) &&
    Number(context.quarterNumber) >= 1 &&
    Number(context.quarterNumber) <= 4
      ? Number(context.quarterNumber)
      : defaultQuarter;
  const targetMonth = QUARTER_MONTH_HINT[quarterNum];

  switch (templateId) {
    case 'DOC_LMC_REGULATION_AND_FILING':
      return {
        templateId,
        title: `[30인+ 작성초안] ${companyName} 노사협의회 규정 및 고용노동부 신고서 양식`,
        subtitle: `근로자참여법 제4조·제17조 | 설치일(${triggerDate})로부터 15일 이내(${dueDate}까지) 관할 노동관서 제출용 초안`,
        body: `※ 안내: 본 문서는 사업장 규모(${lsaCount}인)에 맞춰 자동 생성된 [작성 보조용 표준 초안]입니다.
   실제 위원 선출·의결 절차를 거친 뒤 공란을 채우고 서명하여 관할 지방고용노동관서에 제출하십시오.

======================================================================
[별지 제1호서식] 노사협의회 규정 제정 신고서 (작성 초안)
======================================================================
1. 사업장 명칭 : ${companyName} (사업자등록번호: ${bizRegNo})
2. 주된 업종   : ${industry.name}
3. 상시근로자수 : ${lsaCount}명 (근로기준법 시행령 제7조의2 산정치)
4. 노사협의회 설치(예정)일 : ${triggerDate}
5. 법정 신고 마감기한 : ${dueDate} (설치일로부터 15일 이내)
6. 위원 구성 계획 (실제 선출·위촉 인원 기입)
   - 근로자위원 : ____명 (${hasUnion ? '과반수 노동조합 위촉 대상' : '근로자 직접·비밀·무기명 투표 선출 대상'})
   - 사용자위원 : ____명 (대표자 및 대표자 위촉자, 근로자위원과 동수 구성)
   - 고충처리위원 : ____명 (3명 이내 선임 예정 — 근참법 제26조)

[제출 전 필수 확인 체크리스트]
 [ ] 1. ${companyName} 노사협의회 규정 전문 1부 첨부 여부
 [ ] 2. 근로자위원 선출 투표 공고·개표 확인서(또는 과반수 노조 위촉장) 사본 1부
 [ ] 3. 노사협의회 규정 제정 의결 회의록(출석위원 서명본) 사본 1부

----------------------------------------------------------------------
${companyName} 노사협의회 규정 (표준 초안)
----------------------------------------------------------------------
제1조(목적) 이 규정은 「근로자참여 및 협력증진에 관한 법률」에 따라 ${companyName}에 설치하는 노사협의회의 조직과 운영에 관한 사항을 규정함을 목적으로 한다.

제2조(구성 및 임기) ① 협의회는 근로자와 사용자를 대표하는 동수의 위원으로 구성하되, 각 ( 3 )인으로 한다.
② 근로자위원은 ${hasUnion ? '근로자의 과반수로 조직된 노동조합의 대표자와 그 노동조합이 위촉하는 자로 한다.' : '근로자의 직접·비밀·무기명 투표로 선출한다.'}
③ 위원의 임기는 3년으로 하되 연임할 수 있다.

제3조(정기회의 및 소집통지) ① 협의회는 매 분기(3개월)마다 1회 정기적으로 회의를 개최한다.
② 의장은 회의 개최 7일 전에 회의 일시, 장소, 의제 등을 각 위원에게 통보하여야 한다.

제4조(협의·의결·보고사항) 협의회는 법 제20조(협의사항), 제21조(의결사항: 근로자 교육훈련, 복지시설 설치 등), 제22조(보고사항: 경영계획 전반 및 실적, 분기별 생산계획, 인력계획 등)를 다룬다.

제5조(회의록 비치) 협의회는 회의록을 작성하여 출석위원 전원이 서명 또는 날인하고 작성일로부터 3년간 보존한다.

제6조(고충처리위원) 회사는 근로자의 고충을 청취·처리하기 위하여 3인 이내의 고충처리위원을 두며, 고충 접수일로부터 10일 이내에 조치 사항과 처리 결과를 당해 근로자에게 통보한다.`,
      };

    case 'DOC_LMC_MINUTES':
      return {
        templateId,
        title: `[${refYear}년 ${quarterNum}분기 양식] ${companyName} 노사협의회 정기회의 소집통지 및 회의록 초안`,
        subtitle: `근로자참여법 제12조·제19조 | ${refYear}년 ${quarterNum}분기(예정월: ${targetMonth}월) 작성 보조 양식`,
        body: `※ 안내: 본 양식은 ${refYear}년 ${quarterNum}분기 노사협의회 운영을 위한 [회의록 작성 초안]입니다.
   실제 회의 개최 7일 전 소집통지를 발송하고, 회의 종료 후 실제 출석·의결 결과와 서명을 남기십시오.

======================================================================
${companyName} ${refYear}년 제${quarterNum}분기 노사협의회 정기회의록 (작성 양식)
======================================================================
- 개최 일시 : ${refYear}년 ${targetMonth}월 ___일  ___:___ ~ ___:___ (소집통지 발송일: ${refYear}-${targetMonth}-___, 개최 7일 전 확인 [ ])
- 개최 장소 : ________________________
- 출석 현황 : 근로자위원 재적 ___명 중 ___명 출석 / 사용자위원 재적 ___명 중 ___명 출석

1. 사용자측 보고사항 (법 제22조 — 해당 항목 기재)
  가. ${quarterNum}분기 경영실적 및 차기 분기 사업·생산계획 보고 : (내용 기입)
  나. 인력 운영 및 채용 계획 보고 (현재 상시근로자 ${lsaCount}명 기준) : (내용 기입)

2. 노사 협의사항 (법 제20조 — 실제 논의 내용 기재)
  가. 작업환경 개선 및 직무역량 교육 지원 방안 : (내용 기입)
  나. 연차유급휴가 사용 장려 및 근무일정 조율 방안 : (내용 기입)
  다. 고충처리위원 ${quarterNum}분기 접수·처리 현황 점검 : (접수 ___건 / 처리 ___건)

3. 노사 의결사항 (법 제21조)
  - 상정 안건 : ________________________________________
  - 의결 결과 : [ ] 가결   [ ] 수정가결   [ ] 부결   [ ] 차기 이월 (찬성 ___명 / 반대 ___명)

4. 직전 분기 의결사항 이행 점검
  - 이행 상태 : [ ] 이행 완료   [ ] 진행 중   [ ] 미이행 (사유: ________________________)

- 서명란 : 의장 ____________ (서명) / 근로자위원 ____________ (서명) / 사용자위원 ____________ (서명)
* 작성 완료 후 출석위원 전원 서명본을 작성일로부터 3년간 보존하여야 합니다.`,
      };

    case 'DOC_OSH_OFFICER_APPOINTMENT': {
      const modeText =
        oshCount >= 300
          ? '전담 안전관리자·보건관리자 직접 선임 대상 (상시 300인 이상 전담 의무)'
          : '자체 유자격자 선임 또는 고용노동부 지정 안전·보건관리전문기관 위탁 선임 선택 가능 (상시 50~299인)';
      return {
        templateId,
        title: `[50인+ 업종 작성초안] 안전보건관리책임자 · 안전관리자 · 보건관리자 선임 등 보고서`,
        subtitle: `산업안전보건법 제15조~제19조 | 선임일(${triggerDate})로부터 14일 이내(${dueDate}까지) 관할 노동청 제출용 초안`,
        body: `※ 안내: 본 문서는 [${industry.name} / 산안법 기준 ${oshCount}인] 사업장용 [선임 보고서 작성 초안]입니다.
   실제 선임자 인적사항·자격번호(또는 전문기관 위탁계약 내용)를 기입해 선임 후 14일 이내 제출하십시오.

======================================================================
[산업안전보건법 시행규칙 별지 제2호서식] 관리책임자·안전관리자·보건관리자 선임 등 보고서 (초안)
======================================================================
1. 사업장 개요
   - 사업장명 : ${companyName} (사업자등록번호: ${bizRegNo})
   - 업종구분 : ${industry.name}
   - 상시근로자 수 : ${oshCount}명 (현장 파견근로자 포함 산안법 기준)
   - 선임(위탁계약)일 : ${triggerDate}  |  법정 보고 마감기한 : ${dueDate} (14일 이내)

2. 선임 대상별 작성 및 확인란
   [ ] [1] 안전보건관리책임자 (법 제15조)
       - 성명 / 직위 : ________________ / ________________ (사업장 실질 총괄 관리책임자)
   [ ] [2] 관리감독자 지정 (법 제16조 — 부서별 사내 지정서 비치 대상, 노동청 신고 서식 제외)
       - 대상 부서장 지정 여부 : [ ] 지정 완료   [ ] 지정 예정 (연간 정기교육 16시간 대상)
   [ ] [3] 안전관리자 선임 (법 제17조)
       - 선임 형태 기준 : ${modeText}
       - 성명(또는 위탁기관명) : ________________________ / 자격·지정번호 : ________________
   [ ] [4] 보건관리자 선임 (법 제18조)
       - 선임 형태 기준 : ${modeText}
       - 성명(또는 위탁기관명) : ________________________ / 자격·지정번호 : ________________

3. 첨부 증빙 확인 체크리스트
   [ ] 국가기술자격증·면허증 사본 및 재직증명서 (자체 선임 시)
   [ ] 안전·보건관리 대행(위탁)계약서 사본 (전문기관 위탁 선임 시)`,
      };
    }

    case 'DOC_OSH_MINUTES':
      return {
        templateId,
        title: `[${refYear}년 ${quarterNum}분기 양식] ${companyName} 산업안전보건위원회 회의록 및 위험성평가 점검표 초안`,
        subtitle: `산업안전보건법 제24조·제36조 | ${refYear}년 ${quarterNum}분기(예정월: ${targetMonth}월) 작성 보조 양식`,
        body: `※ 안내: 본 양식은 ${refYear}년 ${quarterNum}분기 산업안전보건위원회 심의·의결 및 위험성평가 점검용 [작성 초안]입니다.

======================================================================
${companyName} ${refYear}년 제${quarterNum}분기 산업안전보건위원회 회의록 (작성 양식)
======================================================================
- 개최 일시 : ${refYear}년 ${targetMonth}월 ___일  ___:___ ~ ___:___
- 사업장 / 업종 : ${companyName} / ${industry.name} (상시 ${oshCount}명)
- 위원 출석 : 근로자위원(근로자대표·명예산안감독관 등) ___명 / 사용자위원(관리책임자·안전·보건관리자) ___명

[심의·의결 안건 기록란 (산안법 제24조 제2항)]
 1. 산업재해 예방계획 수립·시행 점검 : (논의 및 의결 내용 기입)
 2. ${quarterNum}분기 안전보건교육 실시 현황 점검 : (사무직 ${industry.quarterlySafetyEduHoursOffice}h / 현장직 ${industry.quarterlySafetyEduHoursField}h 이수율 ___%)
 3. 작업환경측정 및 건강진단 사후관리 조치 : (내용 기입)
 4. 유해·위험요인 위험성평가 감소대책 이행 점검 : (내용 기입)

[위험성평가 이행 자가점검 체크리스트 (산안법 제36조 — 확인 후 체크)]
 [ ] 공정별 유해·위험요인 파악 과정에 해당 작업 근로자를 참여시켰는가?
 [ ] 허용 불가능한 위험성 항목에 대한 감소대책과 개선 일정을 수립·시행했는가?
 [ ] 평가 결과 및 조치사항을 근로자에게 공지하고 기록을 3년간 보존했는가?`,
      };

    case 'DOC_WORK_RULES_REPORT':
      return {
        templateId,
        title: `[10인+ 작성초안] ${companyName} 취업규칙 신고서 및 과반수 의견청취(동의)서 양식`,
        subtitle: '근로기준법 제93조·제94조 | 상시 10인 이상 사업장 필수 작성·검토 후 신고용 초안',
        body: `※ 안내: 본 양식은 상시 10인 이상 진입 사업장(${lsaCount}인)의 취업규칙 제정·변경을 위한 [작성 보조 초안]입니다.

======================================================================
취업규칙 제정(변경) 신고서 및 근로자 과반수 의견청취(동의)서 (초안)
======================================================================
1. 사업장명 : ${companyName} (상시근로자 ${lsaCount}명)
2. 환경설정 연동 사내 표준 기준
   - 정기 임금지급일 : ${payDayLabel}
   - 연차유급휴가 산정 기준 : ${leavePolicySummary}
3. 근로기준법 제93조 필수 기재 항목 포함 여부 자가점검란
   [ ] 업무의 시작과 종료 시각, 휴게시간, 휴일, 휴가 및 교대근로에 관한 사항
   [ ] 임금의 결정·계산·지급방법, 임금의 산정기간·지급시기(${payDayLabel}) 및 승급에 관한 사항
   [ ] 가족수당의 계산·지급방법, 퇴직급여(퇴직금·DB·DC)에 관한 사항
   [ ] 표창과 제재(감봉 시 제95조 한도 준수 여부 포함)에 관한 사항
   [ ] 직장 내 괴롭힘의 예방 및 발생 시 조치 등에 관한 사항
   [ ] 출산전후휴가·육아휴직 등 모성보호 및 일·가정 양립 지원에 관한 사항
4. 의견청취 / 동의 절차 구분 :
   - ${hasUnion ? '[과반수 노동조합 있음] 노동조합 대표자의 의견서(불이익 변경 시 동의서) 첨부 필요' : '[과반수 노동조합 없음] 전체 근로자 과반수의 의견청취서(불이익 변경 시 집단적 과반수 동의서) 첨부 필요'}`,
      };

    case 'DOC_CAREER_CERTIFICATE': {
      const al = context.alumniRecord || {};
      const workerName = safeText(al.displayName, '홍길동');
      const deptName = safeText(al.deptName, '일반부서');
      const jobTitle = safeText(al.jobTitle, '담당');
      const hireDate = safeText(al.hireDate, '2023-01-01');
      const lastWorkDate = safeText(al.lastWorkDate, referenceDate);
      return {
        templateId: 'DOC_CAREER_CERTIFICATE',
        title: `[제39조 사용증명서 초안] ${companyName} 경력증명서 (${workerName})`,
        subtitle: '근로기준법 제39조(사용증명서)·제40조(취업 방해의 금지) 가드레일 자동 적용 양식',
        body: `※ 법정 가드레일 안내 (근로기준법 제39조 제2항·제40조):
   사용증명서에는 근로자가 요구한 사항만 적어야 하며, 퇴직·해고 사유나 취업을 방해할 우려가 있는 비밀기호·불이익 문구는 본 양식에서 자동 차단되었습니다.

======================================================================
사 용 증 명 서 (경 력 증 명 서)
======================================================================
1. 인적 사항
   - 성    명 : ${workerName} (사번: ${safeText(al.empCode, 'EMP-000')} / 생년월일: ${safeText(al.maskedBirthOrId, '******-*')})

2. 재직 및 담당 업무 사항 (근로자 청구 항목만 기재)
   - 사업장명 : ${companyName} (사업자등록번호: ${bizRegNo})
   - 소속부서 : ${deptName}
   - 직위/직무 : ${jobTitle}
   - 사용기간 : ${hireDate} ~ ${lastWorkDate} (총 ${Number(al.serviceDays ?? 0).toLocaleString('ko-KR')}일)
   - 퇴직사유 : [근로자 별도 기재 청구 없음 — 근로기준법 제39조 제2항에 따라 미기재]

3. 발급 용도 : 경력 확인 제출용 (발급 기준일: ${referenceDate})

위와 같이 재직하였음을 증명합니다.

${referenceDate}
발급자 : ${companyName} 대표이사 (직인 날인란)`,
      };
    }

    case 'DOC_EI_SEPARATION_CERT': {
      const al = context.alumniRecord || {};
      const workerName = safeText(al.displayName, '퇴사근로자');
      return {
        templateId: 'DOC_EI_SEPARATION_CERT',
        title: `[M9 상실·이직초안] ${workerName} 4대보험 자격상실 및 고용보험 이직확인서 작성 보조표`,
        subtitle: `건강보험 상실기한(${safeText(al.nhisLossDueDate)}) · 고용보험 상실기한(${safeText(al.eiLossDueDate)}) · 14일 금품청산(${safeText(al.settlementDueDate)})`,
        body: `※ 안내: 본 문서는 공단 EDI(4대사회보험 정보연계센터·고용24) 신고 전 수치를 대조하기 위한 [작성 보조 초안]입니다.

======================================================================
4대보험 직장가입자 자격상실 및 고용보험 이직확인서 대조표
======================================================================
1. 사업장 : ${companyName} (사업자등록번호: ${bizRegNo})
2. 대상자 : ${workerName} (${safeText(al.empCode)} / ${safeText(al.maskedBirthOrId)}) — 소속: ${safeText(al.deptName)}
3. 자격변동 일자 대조
   - 피보험자격 취득일(입사일) : ${safeText(al.hireDate)}
   - 마지막 근무일(퇴직일)    : ${safeText(al.lastWorkDate)}
   - 공단 신고 상실일(익일)   : ${safeText(al.lossDateReported)} (※ 실무 기준 퇴직일 다음 날 기재)
4. 상실(이직) 사유 구분
   - 고용보험 상실코드 : ${safeText(al.eiLossCode)} (${safeText(al.resignReasonLabel)})
   - 수급자격 안내     : ${safeText(al.unemploymentEligibleHint)}
5. 퇴직 정산 및 법정 기한 점검
   - 퇴직금 산정액     : ${Number(al.severancePay ?? 0).toLocaleString('ko-KR')}원 (${al.eligibleForSeverance ? '1년 이상·주15h 이상 대상' : '1년 미만 비대상'})
   - 미사용연차수당    : ${Number(al.unusedLeavePayout ?? 0).toLocaleString('ko-KR')}원 (${Number(al.unusedLeaveDays ?? 0)}일분)
   - 총 금품청산 예정액 : ${Number(al.totalSettlementGross ?? 0).toLocaleString('ko-KR')}원 (법정 지급기한: ${safeText(al.settlementDueDate)}, 근기법 제36조 14일 이내)
   - 법정 서류 보존만료 : ${safeText(al.retentionExpiresOn)} 까지 3년 의무 보존 (근로기준법 제42조)`,
      };
    }

    case 'DOC_EMPLOYMENT_CERT': {
      const wk = context.workerRecord || {};
      const wkName = safeText(wk.displayName, '재직근로자');
      return {
        templateId: 'DOC_EMPLOYMENT_CERT',
        title: `[M3 재직증명서] ${wkName} (${safeText(wk.empCode)}) 재직 사실 확인 증명서`,
        subtitle: `근로기준법 제39조 준용 · 발급 기준일 ${referenceDate}`,
        body: `======================================================================
재 직 증 명 서 (발급 초안)
======================================================================
1. 인적사항
   - 성명(사번) : ${wkName} (${safeText(wk.empCode)})
   - 생년월일   : ${safeText(wk.maskedBirthOrId, '******-*')}

2. 재직사항
   - 사업장명   : ${companyName} (사업자등록번호: ${bizRegNo})
   - 소속부서   : ${safeText(wk.deptName, '일반부서')}
   - 직위/구분  : ${safeText(wk.jobTitle, '사원')} (${safeText(wk.workerCategory, 'REGULAR')})
   - 입사일자   : ${safeText(wk.hireDate, '2024-01-02')} ~ 현재 재직 중

3. 발급 용도 : 금융기관 · 관공서 제출용 (발급일: ${referenceDate})

위 사람은 현재 당사에 재직하고 있음을 증명합니다.

${referenceDate}
발급자 : ${companyName} 대표이사 (직인 날인란)`,
      };
    }

    case 'DOC_ANNUAL_LEAVE_PROMOTION': {
      const wk = context.workerRecord || {};
      const wkName = safeText(wk.displayName, '대상근로자');
      return {
        templateId: 'DOC_ANNUAL_LEAVE_PROMOTION',
        title: `[M5 연차사용촉진 서면통지서] ${wkName} (${safeText(wk.empCode)}) 미사용 연차유급휴가 사용촉진 통지`,
        subtitle: '근로기준법 제61조 (연차유급휴가의 사용 촉진 — 1차 미사용일수 고지 및 2차 시기지정 서면 양식)',
        body: `※ 안내: 근로기준법 제61조에 따라 연차미사용수당 지급의무를 적법하게 면제받으려면 반드시 [서면]으로 1차(만료 6개월 전 기준 10일 이내)·2차(만료 2개월 전까지) 통보 및 근로자 수령 확인이 이루어져야 합니다.

======================================================================
미사용 연차유급휴가 사용촉진 서면 통지서 (작성 초안)
======================================================================
1. 수신 근로자 : ${wkName} (${safeText(wk.empCode)}) / 소속 : ${safeText(wk.deptName)}
2. 입사일자    : ${safeText(wk.hireDate, '2023-03-02')}
3. 당해 연차 산정 및 잔여 내역 (기준일: ${referenceDate} | 운영기준: ${leavePolicySummary})
   - 사용기한 만료일 : ${safeText(wk.cycleExpiryDate, `${referenceDate.slice(0, 4)}-12-31`)}
   - 총 발생 연차일수 : ${Number(wk.accruedDays ?? 15)}일
   - 기 사용 연차일수 : ${Number(wk.usedDays ?? 3)}일
   - 미사용 잔여일수  : ${Number(wk.remainingDays ?? 12)}일

4. 근로기준법 제61조에 따른 안내사항
   [1차 촉진] 통보받은 날부터 10일 이내에 미사용 휴가의 사용 시기를 정하여 회사에 서면(또는 전자결재)으로 통보해 주시기 바랍니다.
   [2차 지정] 기한 내 사용 시기를 통보하지 아니한 경우, 회사가 만료 2개월 전까지 사용 시기를 지정하여 서면 통보하며, 그럼에도 사용하지 아니한 연차휴가는 소멸되고 금전보상 의무가 면제됩니다. (단, 회사의 노무수령 거부 입증이 수반되어야 유효함)

${referenceDate}
통지인 : ${companyName} 대표이사 (인)  |  수령 확인 : ${wkName} (서명/인)`,
      };
    }

    case 'DOC_DISCIPLINE_WRITTEN_NOTICE': {
      const wk = context.workerRecord || {};
      const wkName = safeText(wk.displayName, '대상근로자');
      return {
        templateId: 'DOC_DISCIPLINE_WRITTEN_NOTICE',
        title: `[M7 적법징계 서면통지서] ${wkName} (${safeText(wk.empCode)}) 징계위원회 출석·소명 및 제95조 한도 검토서`,
        subtitle: '근로기준법 제23조(정당한 이유) · 제27조(서면통지) · 제95조(감봉 제재 한도 제한)',
        body: `※ 안내: 취업규칙상 출석통지 기한 준수, 충분한 소명기회 부여, 징계위원회 의결 및 구체적 사유 서면통지가 누락될 경우 부당징계 판정 위험이 있습니다.

======================================================================
징계위원회 출석통지 및 제95조 감봉 법정한도 검토서 (작성 초안)
======================================================================
1. 대상자 : ${wkName} (${safeText(wk.empCode)}) / 소속 : ${safeText(wk.deptName)}
2. 적법 절차 이행 점검 현황
   - [${wk.attendanceNoticeSent ? 'V' : ' '}] 1단계: 징계위원회 개최 사전 서면 출석통지 완료
   - [${wk.defenseOpportunityGiven ? 'V' : ' '}] 2단계: 당사자 진술 및 소명자료 제출 기회 부여 완료
   - [${wk.committeeResolved ? 'V' : ' '}] 3단계: 징계위원회 개최 및 의결 정족수 확인 완료
   - [${wk.writtenNoticeDelivered ? 'V' : ' '}] 4단계: 징계 사유·양정·재심절차 서면통지 교부 완료

3. 근로기준법 제95조(제재 규정의 제한) 감봉액 자동 심사
   - 요청된 감봉 금액       : ${Number(wk.requestedDisciplinaryCut ?? 0).toLocaleString('ko-KR')}원
   - 법정 상한(일급 1/2·월 1/10) 이내 적법 반영액 : ${Number(wk.appliedCut ?? 0).toLocaleString('ko-KR')}원
   - 법정 한도 초과 자동 차단액 : ${Number(wk.blockedCut ?? 0).toLocaleString('ko-KR')}원

${referenceDate}
${companyName} 인사징계위원회 위원장 (서명/인)`,
      };
    }

    case 'DOC_PRIVACY_CONSENT': {
      const wk = context.workerRecord || {};
      const hasBoundWorker = Boolean(wk.empCode);
      const wkName = hasBoundWorker ? safeText(wk.displayName) : '____________';
      const wkCode = hasBoundWorker ? safeText(wk.empCode) : 'EMP-____';
      const wkDept = hasBoundWorker ? safeText(wk.deptName) : '____________';
      const wkHire = hasBoundWorker ? safeText(wk.hireDate, referenceDate) : '______년 ___월 ___일';
      return {
        templateId: 'DOC_PRIVACY_CONSENT',
        title: hasBoundWorker
          ? `[개인정보동의서] ${companyName} 임직원 개인정보 수집·이용·제3자 제공 동의서 (${wkName})`
          : `[입사·인사 표준양식] ${companyName} 임직원 개인정보 수집·이용·제3자 제공 동의서`,
        subtitle:
          '개인정보 보호법 제15조·제17조·제22조·제23조·제24조의2 | 근로기준법 제42조(3년 보존) 반영 양식',
        body: `※ 법정 작성 안내 (개인정보 보호법 제22조·제24조의2):
   필수 동의와 선택 동의, 민감정보 처리 및 제3자 제공 동의는 각각 구분하여 개별 체크를 받아야 하며,
   주민등록번호는 임의 동의가 아닌 법령상 의무(소득세법·4대사회보험법) 근거에 의하여만 처리됩니다.

======================================================================
임직원 개인정보 수집 · 이용 · 제3자 제공 동의서 (작성 초안)
======================================================================
- 사업장명(개인정보처리자) : ${companyName} (사업자등록번호: ${bizRegNo})
- 대상 근로자 성명(사번)   : ${wkName} (${wkCode})  |  소속부서 : ${wkDept}  |  입사(예정)일 : ${wkHire}

1. [필수] 인사 · 노무 · 급여관리 목적 개인정보 수집 · 이용 동의 (법 제15조 제1항)
   - 수집·이용 목적 : 근로계약 체결·이행, 인사명부·발령·근태·연차·인사평가 관리, 급여·퇴직급여 산정 및 지급, 증명서 발급, 산업안전보건·법정의무교육 이수 관리
   - 수집 항목(필수) : 성명, 생년월일, 연락처(010-****-****), 주소, 이메일, 급여계좌(은행명·계좌번호), 학력·경력·자격사항, 입·퇴사일, 부서·직위, 근태·연차·급여 내역
   - 보유 및 이용기간 : 재직 기간 중 보유하며, 퇴직 후 근로기준법 제42조에 따라 **3년간 의무 보존** (단, 국세기본법 제85조의3에 따른 원천징수 세무 증빙은 5년 분리 보관 후 지체 없이 비식별·영구 파기)
   - 동의 거부권 안내 : 귀하는 동의를 거부할 권리가 있으나, 필수 항목 동의를 거부할 경우 근로계약 체결, 급여 지급 및 4대보험 신고 등 정상적인 인사·노무 관리가 제한될 수 있습니다.
   ▶ 위 필수 개인정보 수집·이용에 동의하십니까?   [ ] 동의함     [ ] 동의하지 않음

2. [법령 근거 고지 — 별도 동의 불요] 고유식별정보(주민등록번호·외국인등록번호) 법정 처리 안내 (법 제24조의2)
   - 회사는 다음 법령에서 구체적으로 처리를 요구·허용한 범위에 한하여 고유식별정보(******-*******)를 처리하며, 목적 외 용도로 사용하지 않습니다.
     * 소득세법 제145조·제164조 (근로·퇴직·사업소득 원천징수영수증 및 지급명세서 제출)
     * 국민연금법·국민건강보험법·고용보험법·산업재해보상보험법 (4대사회보험 자격취득·보수월액·상실 신고)
     * 근로자퇴직급여 보장법 (퇴직연금 가입 및 급여 지급)

3. [선택] 임직원 복리후생 · 비상연락 · 경조사 지원 목적 수집 · 이용 동의 (법 제22조 제4항)
   - 수집·이용 목적 : 명절·경조사 지원, 사내 동호회·복지포인트 운영, 긴급 안전사고 시 비상연락, 사내 조직도 게시
   - 수집 항목(선택) : 비상연락처(가족 관계·연락처), 증명사진, 차량번호(사내 주차 시), 결혼기념일·경조사항
   - 보유 및 이용기간 : 재직 기간 중 (동의 철회 또는 퇴직 시 지체 없이 파기)
   - 동의 거부권 안내 : 선택 항목에 동의하지 않아도 채용·근로조건·인사상 어떠한 불이익도 없습니다.
   ▶ 위 선택 개인정보 수집·이용에 동의하십니까?   [ ] 동의함     [ ] 동의하지 않음

4. [별도 동의] 민감정보(건강·장애·산재 등 해당자 한함) 처리 동의 (법 제23조)
   - 처리 목적 및 항목 : 산업안전보건법상 건강진단 사후관리 소견, 장애인고용촉진법상 의무고용 산정 증빙(해당자에 한함), 모성보호·육아기 단축근무 신청 증빙
   - 보유 및 이용기간 : 관련 법정 의무 보존기간(3년) 종료 시 즉시 파기
   ▶ 위 민감정보 처리에 동의하십니까?             [ ] 동의함     [ ] 동의하지 않음     [ ] 해당 없음

5. [별도 동의] 개인정보 제3자 제공 동의 (법 제17조 제1항)
   - 제공받는 자 : 주거래 급여이체 은행, 퇴직연금 사업자, 위탁 세무·노무법인, 고용노동부 지정 안전보건·법정의무교육 기관, 건강검진 의료기관
   - 제공 목적   : 급여·퇴직연금 지급, 원천세·4대보험 신고 대행, 법정의무교육 수료 등록 및 직장인 건강검진 실시
   - 제공 항목   : 성명, 생년월일, 사번, 소속부서, 입·퇴사일, 급여계좌(은행 한함), 교육이수 식별정보
   - 보유·이용기간 : 각 제공 목적 달성 시 또는 관련 법령상 보존기한 종료 시까지 (동의 거부 가능, 거부 시 해당 급여이체·퇴직연금·위탁 복지 서비스 제공이 제한될 수 있음)
   ▶ 위 개인정보 제3자 제공에 동의하십니까?       [ ] 동의함     [ ] 동의하지 않음

본인은 상기 내용을 충분히 설명 듣고 이해하였으며, 각 항목별로 자유로운 의사에 따라 동의 여부를 체크하였습니다.

${referenceDate}
동의자(근로자) : ${wkName} (서명 또는 인)  |  확인자 : ${companyName} 인사담당 (인)`,
      };
    }

    case 'DOC_NDA_SECURITY_PLEDGE': {
      const wk = context.workerRecord || {};
      const hasBoundWorker = Boolean(wk.empCode);
      const wkName = hasBoundWorker ? safeText(wk.displayName) : '____________';
      const wkCode = hasBoundWorker ? safeText(wk.empCode) : 'EMP-____';
      const wkDept = hasBoundWorker ? safeText(wk.deptName) : '____________';
      const wkTitle = hasBoundWorker ? safeText(wk.jobTitle, '사원') : '________';
      return {
        templateId: 'DOC_NDA_SECURITY_PLEDGE',
        title: hasBoundWorker
          ? `[비밀유지·보안서약서] ${companyName} 영업비밀 보호 및 정보보안 서약서 (${wkName})`
          : `[입사·재직 표준양식] ${companyName} 비밀유지 및 정보보안 서약서`,
        subtitle:
          '부정경쟁방지 및 영업비밀보호에 관한 법률 제2조 제2호·제10조 | 개인정보 보호법 제59조 준수 양식',
        body: `※ 안내: 본 서약서는 입사 시 또는 핵심 프로젝트 투입 시 영업비밀·개인정보 보호 의무를 명확히 하기 위한 [표준 서약 양식]입니다.

======================================================================
비밀유지 및 정보보안 서약서 (입사 · 재직자용 표준 초안)
======================================================================
- 수신(회사명) : ${companyName} 대표이사 귀하 (사업자등록번호: ${bizRegNo} / 업종: ${industry.name})
- 서약자 인적사항 : 소속 ${wkDept}  |  직위 ${wkTitle}  |  사번 ${wkCode}  |  성명 ${wkName}

상기 본인은 ${companyName}(이하 "회사")에 입사·재직함에 있어 회사의 영업비밀, 기술·경영 자료 및 고객·임직원 개인정보를 보호하기 위하여 다음 사항을 성실히 준수할 것을 서약합니다.

제1조 (영업비밀 및 보안대상 정보의 정의)
본 서약서에서 "영업비밀 및 보안정보"란 공공연히 알려져 있지 아니하고 독립된 경제적 가치를 가지는 것으로서 회사가 합리적인 보안 관리 조치를 취하고 있는 일체의 기술상·경영상 정보(제품 설계도, 제조공정·배합비, 소프트웨어 소스코드·아키텍처, 연구개발 데이터, 원가·단가표, 거래처·고객 명부, 입찰·마케팅 전략, 미공개 재무·인사·급여 자료 등)를 말합니다.

제2조 (재직 중 비밀유지 및 정보보안 준수 의무)
1. 본인은 업무 수행 중 지득한 영업비밀 및 보안정보를 회사의 사전 서면 승인 없이 제3자에게 누설·배포하거나 업무 외 목적으로 열람·복제·촬영·사외 반출하지 않겠습니다.
2. 본인에게 부여된 사내 시스템 계정, 비밀번호, 2차 인증 패스키(생체·PIN) 및 출입 권한을 타인과 공유하거나 대여하지 않겠습니다.
3. 인가되지 않은 개인 저장매체(USB, 외장하드), 개인 이메일·메신저, 외부 클라우드 스토리지 및 **외부 생성형 AI 서비스에 회사의 비공개 영업비밀·소스코드·고객 및 임직원 개인정보를 무단 입력·업로드하지 않겠습니다.**
4. 업무상 수집·취급하는 고객 및 동료 임직원의 개인정보를 「개인정보 보호법」 제59조에 따라 정당한 권한 없이 조회·유출·변조하지 않겠습니다.

제3조 (직무발명 및 업무상 저작물의 귀속)
재직 중 회사 업무 범위 내에서 작성·개발한 문서, 도면, 소프트웨어, 데이터 및 직무발명 등은 「저작권법」 제9조(업무상저작물) 및 「발명진흥법」 제10조(직무발명)와 사내 직무발명보상규정이 정하는 절차에 따라 회사에 귀속 또는 승계됨을 확인합니다.

제4조 (제3자 영업비밀 침해 방지 확인)
본인은 이전 직장 또는 제3자의 영업비밀이나 무단 반출 자료를 보유하고 있지 않으며, 이를 당사 업무에 반입·도용하여 회사에 법적 분쟁을 초래하지 않겠습니다.

제5조 (퇴직 시 반납 및 위반 시 책임)
1. 퇴직 또는 보직 변경 시 본인이 관리하던 일체의 문서, 전자파일, 저장매체, 시제품 및 회사 정보자산을 즉시 반납하고 사적 보유 사본을 복구 불가능한 방법으로 영구 삭제하겠습니다.
2. 본 서약 위반으로 회사에 손해를 끼친 경우 사내 취업규칙에 따른 징계 처분 및 「부정경쟁방지 및 영업비밀보호에 관한 법률」 등 관계 법령에 따른 민·형사상 책임을 질 것을 확인합니다.

본인은 위 조항을 숙지하고 자유로운 의사로 서약하며, 서약서 사본 1부를 교부받았음을 확인합니다.

${referenceDate}
서약자(근로자) : ${wkName} (자필 서명/인)  |  사본 수령 확인 : [ ] 교부받음`,
      };
    }

    case 'DOC_EXIT_SECURITY_NONCOMPETE': {
      const rec = context.alumniRecord || context.workerRecord || {};
      const hasBoundPerson = Boolean(rec.empCode);
      const pName = hasBoundPerson ? safeText(rec.displayName) : '____________';
      const pCode = hasBoundPerson ? safeText(rec.empCode) : 'EMP-____';
      const pDept = hasBoundPerson ? safeText(rec.deptName) : '____________';
      const pTitle = hasBoundPerson ? safeText(rec.jobTitle, '담당') : '________';
      const pHire = hasBoundPerson ? safeText(rec.hireDate, '2023-01-01') : '______-__-__';
      const pExit = hasBoundPerson ? safeText(rec.lastWorkDate, referenceDate) : referenceDate;
      return {
        templateId: 'DOC_EXIT_SECURITY_NONCOMPETE',
        title: hasBoundPerson
          ? `[퇴사 보안·경업금지서약서] ${companyName} 퇴직자 비밀유지·자산반납 및 경업금지 서약서 (${pName})`
          : `[퇴사 시 표준양식] ${companyName} 퇴직자 비밀유지·정보자산 반납 및 경업금지 서약서`,
        subtitle:
          '부정경쟁방지법 제2조·제10조 | 헌법 제15조(직업선택의 자유)·민법 제103조 및 대법원 2009다82244 판례 가드레일 반영',
        body: `※ 법정 유효성 가드레일 안내 (대법원 2009다82244 판례 기준):
   경업금지 약정은 ① 보호할 가치 있는 사용자의 영업비밀 존재 여부, ② 퇴직 전 지위·직무, ③ 제한 기간·지역·직종의 합리성,
   ④ 근로자에 대한 대가(보상) 제공 여부, ⑤ 퇴직 경위를 종합 심사하며, 과도한 전직 제한은 민법 제103조에 의해 무효가 될 수 있습니다.
   일반 직무 퇴직자는 [제1유형: 비밀유지·자산반납 전용]을, 핵심 기술·영업비밀 취급자는 합리적 기간(통상 6개월~1년)과 대가를 특정하여 [제2유형]을 선택하십시오.

======================================================================
퇴직자 비밀유지 · 정보자산 반납 및 경업금지 서약서 (작성 초안)
======================================================================
1. 퇴직자 및 재직 정보
   - 회  사  명 : ${companyName} (사업자등록번호: ${bizRegNo} / 업종: ${industry.name})
   - 성명(사번) : ${pName} (${pCode} / 생년월일: ${safeText(rec.maskedBirthOrId, '******-*')})
   - 소속 / 직위 : ${pDept} / ${pTitle}
   - 재직 기간   : ${pHire} ~ ${pExit} (퇴직일: ${pExit})

제1조 (퇴직 후 영업비밀 유지 및 무단 사용·누설 금지)
본인은 재직 중 업무와 관련하여 지득한 회사의 핵심 기술정보(설계도·제조공정·소스코드·연구데이터), 경영·영업정보(원가·단가·입찰조건·거래처 계약현황) 및 임직원·고객 개인정보를 퇴직 후에도 회사의 사전 서면 동의 없이 스스로 부정하게 사용하거나 경쟁업체 등 제3자에게 공개·누설·제공하지 않겠습니다.

제2조 (회사 정보자산 전량 반납 및 사적 사본 영구삭제 확인 체크리스트)
본인은 퇴직일(${pExit}) 기준 아래 항목을 전량 반납 또는 영구 삭제 완료하였음을 확인합니다.
   [ ] 1. 회사 지급 IT·보안장비 반납 완료 (법인 노트북·휴대폰·보안토큰·사원증·출입키)
   [ ] 2. 업무 문서·도면·소스코드·거래처 자료 원본 및 인쇄물 전량 반납·인수인계 완료
   [ ] 3. 개인 소유 PC·스마트폰·외장매체·개인 이메일·클라우드 내 회사 자료 복구불능 영구삭제 완료
   [ ] 4. 사내 ERP·클라우드·메신저·모바일 인사앱 계정 로그아웃 및 접근권한 즉시 해지 확인

제3조 (경업금지 및 핵심인력 유인금지 약정 — 직무별 선택 적용)
※ 아래 두 유형 중 퇴직자의 실제 담당 직무에 부합하는 항목 하나에 체크([V])하고 세부 범위를 특정합니다.
   [ ] [제1유형 — 일반 직무 적용] 비밀유지(제1조) 및 정보자산 반납(제2조) 의무만 적용하며 별도 전직·경업제한 기간을 두지 않음
   [ ] [제2유형 — 핵심 영업비밀·연구개발·임원 직무 개별 약정 적용]
       가. 경업금지 기간 : 퇴직일(${pExit})로부터 (   6   )개월간 [※ 판례 권고: 직무 비례 6개월 ~ 최대 1년 이내 합리적 설정]
       나. 제한 대상 범위 : 본인이 재직 중 직접 취급한 [____________________________________] 핵심 영업비밀을 침해할 우려가 있는 국내외 동종 경쟁 사업체 취업·고문·자문·공동창업 행위로 한정함
       다. 인력·거래처 부당 유인 금지 : 위 기간 동안 회사 재직 임직원에 대한 조직적 전직 유인 또는 기존 거래처의 부당 계약 해지 종용 금지
       라. 경업금지 대가(보상) 약정 확인 (유효성 핵심 요건) :
           [ ] 재직 중 비밀유지·전직제한 특별수당 기지급 (월 금 ________________원)
           [ ] 퇴직 시 별도 경업금지 약정 보상금 지급 합의 (총 금 ________________원, 지급일: ______-__-__)
           [ ] 별도 보상 미책정 (※ 무보상 경업금지 약정은 법원에서 효력이 부정되거나 축소될 수 있으므로 노무·법무 검토 필수)

제4조 (위반 시 구제수단 및 자유의사 확인)
본 서약상의 영업비밀 침해 또는 유효하게 성립한 경업금지 약정 위반 시 회사는 「부정경쟁방지 및 영업비밀보호에 관한 법률」 제10조·제11조에 따른 침해금지·예방청구 및 실제 발생한 손해의 배상을 청구할 수 있음을 확인하며, 충분한 검토 기회를 거쳐 자발적 의사로 서명합니다.

${pExit}
서약자(퇴직자) : ${pName} (자필 서명/인)  |  인수·확인자 : ${companyName} 인사보안담당 ____________ (인)
[ ] 본 서약서 사본 1부를 퇴직자에게 교부함 (수령 서명: ____________)`,
      };
    }

    case 'DOC_EMPLOYMENT_CONTRACT':
    default:
      return {
        templateId: 'DOC_EMPLOYMENT_CONTRACT',
        title: `[1인+ 표준초안] ${companyName} 표준 근로계약서 양식 (근로기준법 제17조 필수항목 반영)`,
        subtitle: '개별 근로자 근로조건 기입 후 서명·즉시 교부용 표준 초안',
        body: `※ 안내: 본 양식은 개별 근로계약 체결 전 근로조건을 기입하기 위한 [표준 근로계약서 초안]입니다.

======================================================================
표준 근로계약서 (작성 초안)
======================================================================
${companyName}(이하 "사용자")와 근로자 ____________(이하 "근로자")는 다음과 같이 근로계약을 체결하고 서면(또는 전자문서)으로 1부를 교부한다.

1. 근로계약기간 : ______년 ___월 ___일부터  [ ] 정함이 없음 / [ ] ______년 ___월 ___일까지
2. 근무장소 및 담당업무 : ________________________ / ________________________
3. 소정근로시간 : 1일 ( 8 )시간, 1주 ( 40 )시간 (업무시작 ___:___ ~ 종료 ___:___, 휴게시간 ___:___ ~ ___:___)
4. 주휴일 및 공휴일 : 매주 ____요일 유급주휴일${lsaCount >= 5 ? ' 및 관공서의 공휴일에 관한 규정에 따른 유급휴일 적용' : ' (5인 미만 사업장 공휴일 약정 여부 별도 기재)'}
5. 임금의 구성항목·계산방법·지급방법
   - 월 기본급 : 금 ________________원 / 고정수당(________) : 금 ________________원 / 식대 : 금 ________________원
   - 연장·야간·휴일 가산 기준 : ${lsaCount >= 5 ? '상시 5인 이상 법정 가산율(50% / 8시간 초과 휴일 100%) 적용' : '상시 5인 미만 가산수당 미적용 특례 (실근로시간 1.0배, 별도 약정 시 기재)'}
   - 임금지급일 : ${payDayLabel} (근로자 본인 명의 계좌 직접 지급 및 산출식 명시 임금명세서 교부)
6. 연차유급휴가 : ${lsaCount >= 5 ? `근로기준법 제60조에 따라 부여 (${leavePolicySummary})` : '상시 5인 미만 법정 의무 면제 (약정 부여 시 일수 기재: ____일)'}

______년 ___월 ___일
사용자 : ${companyName} 대표 ____________ (서명/인)  |  근로자 : ____________ (서명/인)
[ ] 근로계약서 사본 교부 확인 (근로자 수령 서명: ____________)`,
      };
  }
}
