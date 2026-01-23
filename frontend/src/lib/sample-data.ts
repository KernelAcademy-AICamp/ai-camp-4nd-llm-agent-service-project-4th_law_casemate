export interface EvidenceData {
  id: string;
  name: string;
  type: string;
  status: string;
  date: string;
  time: string;
  category: string;
  aiSummary: string;
  images: string[];
}

export interface PrecedentData {
  id: number;
  caseNo: string;
  title: string;
  courtDate: string;
  issue: string;
  keyPoint: string;
  result: string;
  similarity: number;
  summary: string;
  fullText: string;
  similarityReport: {
    title: string;
    resultSummary: string[];
    facts: string[];
    legalAnalysis: string;
    implications: string;
  };
}

export interface CaseData {
  id: string;
  name: string;
  progress: number;
  status: string;
  date: string;
  evidenceCount: number;
  riskLevel: 'low' | 'medium' | 'high';
  client: string;
  opponent: string;
  caseType: string;
  claimAmount: number;
  description?: string;
  period?: string;
}

export const sampleCases: CaseData[] = [
  {
    id: 'CASE-001',
    name: '김OO 명예훼손 사건',
    progress: 80,
    status: '분석중',
    date: '2026-01-15',
    evidenceCount: 8,
    riskLevel: 'medium',
    client: '김OO',
    opponent: '박OO',
    caseType: '명예훼손 (형법 제307조)',
    claimAmount: 50000000,
    description: '온라인 커뮤니티 게시글로 인한 명예훼손',
    period: '2025.11.15 ~ 2026.01.10',
  },
  {
    id: 'CASE-002',
    name: '이OO 사이버 명예훼손',
    progress: 45,
    status: '증거수집',
    date: '2026-01-18',
    evidenceCount: 5,
    riskLevel: 'low',
    client: '이OO',
    opponent: '최OO',
    caseType: '사이버 명예훼손',
    claimAmount: 30000000,
    description: 'SNS 허위사실 유포',
    period: '2025.12.01 ~ 2026.01.05',
  },
  {
    id: 'CASE-003',
    name: '박OO 모욕죄 사건',
    progress: 95,
    status: '완료',
    date: '2026-01-10',
    evidenceCount: 12,
    riskLevel: 'high',
    client: '박OO',
    opponent: '정OO',
    caseType: '모욕 (형법 제311조)',
    claimAmount: 20000000,
    description: '직장 내 공개적 모욕 발언',
    period: '2025.10.20 ~ 2025.12.15',
  },
];

export const sampleEvidenceByDate: Record<string, EvidenceData[]> = {
  '2025-11-15': [
    {
      id: 'ev-001',
      name: '단톡방_캡처_001.jpg',
      type: 'Kakao',
      status: '분석완료',
      date: '2025-11-15',
      time: '14:32',
      category: '폭언/모욕',
      aiSummary: '해당 메시지에서 "업무능력이 없다", "팀에 짐만 된다" 등의 표현이 발견되었습니다. 이는 형법 제311조 모욕죄에 해당할 수 있는 표현으로 분석됩니다.',
      images: ['/placeholder.svg', '/placeholder.svg', '/placeholder.svg', '/placeholder.svg', '/placeholder.svg'],
    },
    {
      id: 'ev-002',
      name: '단톡방_캡처_002.jpg',
      type: 'Kakao',
      status: '분석완료',
      date: '2025-11-15',
      time: '15:10',
      category: '폭언/모욕',
      aiSummary: '추가적인 비방 내용 포함. 공개적인 단체 대화방에서의 발언으로 공연성 요건 충족 가능성 높음.',
      images: ['/placeholder.svg', '/placeholder.svg', '/placeholder.svg'],
    },
  ],
  '2025-11-20': [
    {
      id: 'ev-003',
      name: '단톡방_캡처_003.jpg',
      type: 'Kakao',
      status: '분석완료',
      date: '2025-11-20',
      time: '10:15',
      category: '허위사실',
      aiSummary: '"횡령했다"는 허위사실 적시 발견. 정보통신망법 제70조 위반 가능성.',
      images: ['/placeholder.svg', '/placeholder.svg'],
    },
  ],
  '2025-12-01': [
    {
      id: 'ev-004',
      name: '회식_녹취_001.mp3',
      type: 'Audio',
      status: 'STT완료',
      date: '2025-12-01',
      time: '15:20',
      category: '허위사실',
      aiSummary: '음성 녹취에서 "사기꾼" 발언 확인. 다수인이 있는 자리에서의 발언으로 공연성 인정 가능.',
      images: [],
    },
  ],
};

export const samplePrecedents: PrecedentData[] = [
  {
    id: 1,
    caseNo: '대법원 2022다242649',
    title: '손해배상(기)[정치인의 명예훼손 발언에 대한 위법성조각사유 인정 여부가 문제된 사건]',
    courtDate: '대법원 2025. 6. 26. 선고 2022다242649 판결',
    issue: '인터넷 명예훼손 - 허위사실 적시',
    keyPoint: '34명 단톡방은 불특정 다수로 인정, 공연성 충족',
    result: '유죄 - 벌금 500만원, 손해배상 3,000만원',
    similarity: 92,
    summary: '인터넷 게시판에 허위의 사실을 적시하여 타인의 명예를 훼손한 사건.',
    fullText: `【판시사항】

[1] 민법상 불법행위가 되는 '명예훼손'의 의미 / 순수한 의견 표명 자체만으로 명예훼손이 성립하는지 여부(소극) 및 어떠한 표현이 사실의 적시인지 의견의 진술인지 판단하는 기준

[2] 주장 사실이 특정되지 않은 기간과 공간에서의 구체화되지 않은 사실인 경우, 허위성을 증명하는 방법

[3] 명예훼손과 관련하여 정당의 정치적 주장의 위법성을 판단함에 있어서 고려되어야 할 특수성

[4] 국회의원이던 甲이 방송 등에 출연하여 당시 대통령과 사적 친분이 있던 乙의 해외재산 은닉 및 자금세탁 의혹에 관하여 '스위스 비밀계좌에 들어온 한국 기업의 돈이 乙과 연관되어 있다.', '乙이 미국 기업 회장과 만났고, 乙이 이익을 취했다.'는 등의 발언을 하였는데, 이에 乙이 甲을 상대로 허위사실을 유포하여 乙의 명예를 훼손하였다고 주장하며 손해배상을 구한 사안에서, 위 각 발언은 그것이 정치적 주장임을 고려하더라도 허위사실의 적시에 해당하고 甲이 그 내용을 진실이라고 믿을 만한 상당한 이유가 있다고 볼 사정이 없으며, 악의적이거나 현저히 상당성을 잃은 공격에 해당하여 위법성이 조각된다고 보기 어려운데도, 이와 달리 본 원심판단에 법리오해의 잘못이 있다고 한 사례

【판결요지】

[1] 민법상 불법행위가 되는 명예훼손이란 공연히 사실을 적시함으로써 사람의 품성, 덕행, 명성, 신용 등 인격적 가치에 대하여 사회적으로 받는 객관적인 평가를 침해하는 행위를 말한다. 타인에 대한 의견이나 논평을 표명하면서 그 전제가 되는 사실을 적시한 경우에는 그 의견이나 논평의 전제가 되는 사실이 허위라면 명예훼손에 해당할 수 있고, 의견이나 논평에 관한 표현 형식을 빌리면서 그 전제가 되는 사실이나 암시하는 사실이 존재함을 강하게 나타내는 경우에도 명예훼손에 해당할 수 있다. 그러나 의견을 표명하면서 동시에 그 전제가 되는 사실을 명시하거나 암시한 것이 아니라 순수하게 의견만을 표명하는 것이라면 그로써 그 상대방의 사회적 평가가 다소 저하되더라도 이로써 바로 명예훼손에 해당한다고 단정할 수 없다.

어떠한 표현이 사실의 적시인지 의견의 진술인지를 구별할 때에는 표현의 언어적 의미, 사용된 어휘의 통상적인 의미, 전체적인 표현의 흐름이나 문맥, 표현의 경위와 사회적 배경 등을 종합하여 판단해야 한다.

[2] 의견을 밝히면서 동시에 그 전제가 되는 사실을 적시하거나 암시한 경우, 그것이 명예훼손에 해당하는지를 판단하기 위해서는 적시 또는 암시한 사실이 허위인지를 확정해야 한다. 주장 사실이 특정되지 않은 기간과 공간에서 누군가에 의해 행해졌다고 하는 구체화되지 않은 사실이고, 그것이 있었는지 또는 없었는지를 직접 확인할 수 있는 증거가 없는 경우에는, 주장하는 사실을 뒷받침할 간접사실이 존재하는지 여부와 그러한 간접사실에 의하여 주장 사실의 존재를 추인할 수 있는지에 따라 적시 또는 암시된 사실이 허위인지를 판단할 수밖에 없다.`,
    similarityReport: {
      title: '정보통신망 이용 명예훼손 및 사실 적시에 의한 명예훼손 항소심 판단',
      resultSummary: ['피고인과 검사의 항소를 모두 기각함.'],
      facts: ['피고인은 C과의 관계에서 아이를 출산하였으며...'],
      legalAnalysis: '본 사건과 유사하게 온라인상 허위사실 적시에 의한 명예훼손이 쟁점이 되었으며...',
      implications: '34명 단톡방에서의 발언은 본 판례의 기준에 부합하여 공연성이 인정될 가능성이 높습니다.',
    },
  },
];
