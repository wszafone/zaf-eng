# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**자프영어 (ZAF English)** — 한국인을 위한 영어 단어 & 예문 학습 앱. Claude AI 탑재 버전.

- 단어 등록, 예문 관리, 퀴즈, AI 예문 자동생성, 대시보드(홈) 기능 포함
- 파일(CSV/Excel) 업로드로 단어+예문 일괄 등록 가능

## Running the App

```bash
# 방법 1: 브라우저에서 index.html 직접 열기
# 방법 2: HTTP 서버로 실행
python -m http.server 8000
# → http://localhost:8000
```

빌드·설치·컴파일 없음. 외부 라이브러리는 CDN으로만 로드.

## File Structure

```
index.html   — HTML 뼈대 (nav, section, modal 마크업만)
style.css    — 모든 CSS (변수, 레이아웃, 컴포넌트)
app.js       — 모든 JavaScript (스토리지, 렌더링, 이벤트, Claude API)
```

## Architecture

### Navigation (탭)

| 탭 ID | data-view | 설명 |
|---|---|---|
| 홈 | `home` | 대시보드 — 통계, 오늘의 추천 단어, 학습 현황 |
| 단어퀴즈 | `quiz-word` | 단어 ↔ 뜻 객관식/주관식 |
| 예문퀴즈 | `quiz-sentence` | 영어예문 ↔ 한국어해석 객관식/주관식 |
| 단어관리 | `manage-words` | 단어+예문 통합 관리 (파일 업로드, 인라인 예문) |
| 설정 | `settings` | Claude API 키, TTS, 데이터 관리 |

> **예문관리 탭은 없음** — 예문은 단어관리 탭의 인라인 서브 로우에서 관리

### Data Schemas (localStorage)

```js
// KEY: 'ew_words'
Word = {
  id: UUID,
  word: string,        // 영어 단어
  pos: 'noun'|'verb'|'adj'|'adv'|'etc',
  meaning: string,     // 한국어 뜻
  difficulty: 'middle'|'high',
  createdAt: number,   // timestamp
  stats?: { shown: number, correct: number }
}

// KEY: 'ew_sentences'
Sentence = {
  id: UUID,
  wordId: UUID,   // Word.id 참조
  en: string,     // 영어 예문
  ko: string      // 한국어 해석
}

// KEY: 'ew_settings'
Settings = {
  voiceName: string,      // TTS 음성명
  streak: number,
  lastStudyDate: string,  // 'YYYY-MM-DD'
  dailyGoal: number,
  quizMode: 'multiple'|'subjective',
  defaultLevel: 'all'|'middle'|'high'
}

// KEY: 'ew_api_key'  — Claude API 키 (평문)
```

단어당 예문 최대 **5개**.

### File Upload Format (파일 업로드)

단어관리 탭의 **파일 업로드** 버튼 한 개로 단어+예문 동시 등록.

| A열 (단어) | B열 (단어뜻) | C열 (예문) | D열 (예문뜻) |
|---|---|---|---|
| 헤더 | 헤더 | 헤더 | 헤더 |
| apple | 사과 | I eat an apple. | 나는 사과를 먹는다. |

- 1행은 헤더로 건너뜀
- 단어가 없으면 자동 생성, 이미 있으면 예문만 추가
- C·D열 없으면 단어만 추가
- CSV: UTF-8 BOM 자동 감지, 없으면 EUC-KR로 디코딩 (한국 Windows Excel 대응)
- Excel: XLSX 라이브러리 사용 (`cdn.jsdelivr.net/npm/xlsx@0.18.5`)
- 핵심 함수: `importCombinedRows(rows)`, `readFileAsRows(file)`

### Inline Sentence Sub-row (인라인 예문 관리)

단어 테이블의 **예문 N** 배지를 클릭하면 해당 단어 아래 서브 로우가 펼쳐짐.

- `toggleSentRow(wordId)` — 펼치기/접기
- `renderSentRow(wordId)` — 서브 로우 내용 렌더링
- `updateSentBadge(wordId)` — 배지 숫자 갱신 (테이블 전체 리렌더 없이)
- `deleteSentenceInRow(sentId, wordId)` — 즉시 삭제 후 서브 로우 갱신
- `generateExamplesInRow(wordId)` — Claude AI 예문 2개 생성 → 인라인 패널 표시
- `_aiExamples` — Map(wordId → examples[]), AI 생성 결과 임시 보관

### Key Functions

| 함수 | 역할 |
|---|---|
| `renderWordTable()` | 단어 테이블 + 서브 로우 DOM 렌더링 |
| `renderHome()` | 대시보드 렌더링 |
| `renderQuizSetup(rootId, quizType)` | 퀴즈 설정 화면 |
| `startQuiz(...)` | 퀴즈 세션 시작 |
| `renderQuestion()` | 문제 렌더링 (객관식/주관식) |
| `renderResult()` | 퀴즈 결과 렌더링 |
| `renderSettings()` | 설정 화면 |
| `openWordModal(id)` | 단어 추가/수정 모달 |
| `openSentenceModal(id, wordId)` | 예문 추가/수정 모달 |
| `callClaude(prompt)` | Claude API 단일 호출 |
| `generateExamples(word, meaning, pos)` | 예문 2개 생성 |
| `importCombinedRows(rows)` | 파일 업로드 파싱 및 저장 |
| `showToast(msg)` | 1.6초 토스트 알림 |
| `escapeHtml(s)` | XSS 방지 이스케이프 |
| `navigate()` | 해시 라우터 — 뷰 전환 |

### Claude AI

```js
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // app.js 상단에서 한 곳만 수정
```

- API 키: localStorage `'ew_api_key'` 저장, 설정 탭에서 입력
- 브라우저에서 직접 `https://api.anthropic.com/v1/messages` 호출
- 헤더: `'anthropic-dangerous-direct-browser-access': 'true'` 필수
- 기능: 예문 자동생성 (단어별 인라인), 배치 자동생성 (설정 탭)

## ZAF Project Conventions

- **No framework**: vanilla JS, HTML, CSS only
- **XSS protection**: 사용자 입력·외부 데이터는 반드시 `escapeHtml()` 거쳐서 `innerHTML`에 삽입
- **Toast**: `showToast(message)` — 1.6초 자동 사라짐
- **Modal**: `openModal(id)` / `closeModal(id)` — `.modal-overlay.open` 클래스 토글
- **Hash Router**: `navigate()` — `hashchange` 이벤트로 뷰 전환, `VALID_VIEWS` 배열로 유효성 검사
- **CSS 변수**: `style.css` 최상단 `:root`에 모든 색상·크기 변수 정의
- **섹션 구분**: `app.js`는 `/* ═══ ... ═══ */` 구분선으로 섹션 분리
