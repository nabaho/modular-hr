/**
 * 규모·업종별 자동 생성 규정 · 관공서 신고서 · 정기회의록 작성 보조 초안 생성 엔진
 * - 모든 산출물은 실제 사실관계 기입·검토·서명 전의 「작성 보조용 표준 초안(양식)」으로 제공된다.
 */

import { INDUSTRIES } from './labor-rules.mjs';

export const VALID_DOC_TEMPLATES = Object.freeze([
  'DOC_LMC_REGULATION_AND_FILING',
  'DOC_LMC_MINUTES',
  'DOC_OSH_OFFICER_APPOINTMENT',
  'DOC_OSH_MINUTES',
  'DOC_WORK_RULES_REPORT',
  'DOC_EMPLOYMENT_CONTRACT',
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
2. 근로기준법 제93조 필수 기재 항목 포함 여부 자가점검란
   [ ] 업무의 시작과 종료 시각, 휴게시간, 휴일, 휴가 및 교대근로에 관한 사항
   [ ] 임금의 결정·계산·지급방법, 임금의 산정기간·지급시기 및 승급에 관한 사항
   [ ] 가족수당의 계산·지급방법, 퇴직급여(퇴직금·DB·DC)에 관한 사항
   [ ] 표창과 제재(감봉 시 제95조 한도 준수 여부 포함)에 관한 사항
   [ ] 직장 내 괴롭힘의 예방 및 발생 시 조치 등에 관한 사항
   [ ] 출산전후휴가·육아휴직 등 모성보호 및 일·가정 양립 지원에 관한 사항
3. 의견청취 / 동의 절차 구분 :
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
3. 당해 연차 산정 및 잔여 내역 (기준일: ${referenceDate})
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
   - 임금지급일 : 매월 ___일 (근로자 본인 명의 계좌 직접 지급 및 산출식 명시 임금명세서 교부)
6. 연차유급휴가 : ${lsaCount >= 5 ? '근로기준법 제60조에 따라 부여' : '상시 5인 미만 법정 의무 면제 (약정 부여 시 일수 기재: ____일)'}

______년 ___월 ___일
사용자 : ${companyName} 대표 ____________ (서명/인)  |  근로자 : ____________ (서명/인)
[ ] 근로계약서 사본 교부 확인 (근로자 수령 서명: ____________)`,
      };
  }
}
