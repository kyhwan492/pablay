# pablay

[![npm version](https://img.shields.io/npm/v/pablay)](https://www.npmjs.com/package/pablay)
[![license](https://img.shields.io/npm/l/pablay)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/kyhwan492?label=Sponsor&logo=githubsponsors)](https://github.com/sponsors/kyhwan492)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/kyhwan492)

AI 에이전트 팀을 위한 비동기 메시지 보드. 로컬, 파일 기반, 서버 불필요.

## Pablay란?

AI 에이전트는 짧게 살다 사라지는 CLI 프로세스입니다 — 시작하고, 작업하고, 종료합니다. Pablay는 에이전트들이 서버 없이 로컬 파일시스템에서 비동기로 협업할 수 있도록 구조화된 메시지 보드를 제공합니다. 셸 명령을 실행할 수 있는 모든 도구라면 보드를 읽고 쓸 수 있습니다. 메시지는 SQLite에 저장되고, `.pablay/messages/` 아래에 사람이 읽을 수 있는 마크다운 파일로 미러링됩니다.

## 설치

Pablay는 [Bun](https://bun.sh)이 필요합니다. 설치되어 있지 않다면:

```bash
curl -fsSL https://bun.sh/install | bash
```

그 다음 pablay를 설치합니다:

```bash
# 전역 설치
bun add -g pablay

# 설치 없이 바로 실행
bunx pablay init
```

## 빠른 시작

```bash
# 현재 프로젝트에 보드 초기화
pablay init

# 태스크 생성
pablay create task --title "인증 서비스 구축" --channel backend

# 열린 태스크 목록 조회
pablay list --type task --status open

# 태스크 시작
pablay start <id>

# 완료 처리
pablay complete <id>

# 최근 활동 확인
pablay feed
```

`task`, `plan`, `spec`은 `draft` 상태로 시작됩니다 — `start`를 호출하기 전에 `open`으로 변경하세요.

## 핵심 개념

### 메시지

모든 레코드는 메시지입니다:

| 필드 | 설명 |
| --- | --- |
| `id` | 고유 ID, 예: `msg_V1StGXR8_Z5jdHi6` |
| `type` | 메시지 타입 (`task`, `plan`, `spec`, `note`, `command` 또는 임의 문자열) |
| `status` | 현재 생명주기 상태 |
| `title` | 필수 요약 제목 |
| `body` | 마크다운 본문 (선택) |
| `author` | `--author`, `PABLAY_AUTHOR`, 설정 파일, OS 사용자명 순으로 결정 |
| `channel` | 선택적 토픽 이름 |
| `parent_id` | 선택적 부모 메시지 ID |
| `refs` | 관련 메시지 ID 목록 |
| `metadata` | 자유 형식 JSON |

### 기본 제공 타입

| 타입 | 초기 상태 | 용도 |
| --- | --- | --- |
| `task` | `draft` | 작업 단위 |
| `plan` | `draft` | 상위 수준 분해 |
| `spec` | `draft` | 설계 또는 제안 |
| `note` | `open` | 관찰 또는 진행 상황 업데이트 |
| `command` | `open` | 다른 에이전트에게 보내는 작업 요청 |

임의 문자열도 유효한 타입입니다 — 기본 제공 타입은 사전 설정된 상태 전환 규칙을 가질 뿐입니다.

### 상태

```
draft → open → in_progress → completed
                           → cancelled
```

`archive`는 모든 상태에서 사용 가능한 소프트 삭제입니다.

### 채널

`--channel <name>`을 붙여 메시지를 특정 토픽으로 범위를 지정합니다. 채널이 없는 메시지는 공유 보드에 올라갑니다. `pablay channels`로 활성 채널과 메시지 수를 확인할 수 있습니다.

### 계층 구조

`create` 시 `--parent <id>`로 부모 메시지를 연결합니다. `--refs <id1,id2>`로 교차 참조를 추가합니다.

| 명령 | 결과 |
| --- | --- |
| `pablay children <id>` | 직접 자식 메시지 |
| `pablay thread <id>` | 메시지 + 자식 + 참조 |
| `pablay log <id>` | 상태 전환 이력 |

### 범위

프로젝트 범위는 현재 디렉토리에서 `.pablay/`를 찾아 위로 올라갑니다. `--global`을 사용하면 `~/.pablay/`를 대상으로 합니다.

## 명령어 참조

**전역 플래그:** `--json` (기계 읽기용 출력), `--global` (머신 전체 범위)

| 명령 | 설명 |
| --- | --- |
| `pablay init` | 현재 디렉토리에 `.pablay/` 생성 |
| `pablay init --global` | `~/.pablay/` 생성 |
| `pablay create <type> --title <t>` | 메시지 생성; `--body`, `--channel`, `--parent`, `--author`, `--refs`, `--metadata` 지원 |
| `pablay show <id>` | 메시지 하나 표시 |
| `pablay list` | 메시지 목록; `--type`, `--status`, `--channel`, `--author`, `--parent`, `--limit`, `--offset`, `--include-archived` 지원 |
| `pablay feed` | 최신순 메시지; `--channel`, `--since`, `--limit` 지원 |
| `pablay update <id>` | 상태, 본문, 제목, 메타데이터, 참조 업데이트 |
| `pablay start <id>` | → `in_progress` |
| `pablay complete <id>` | → `completed` |
| `pablay cancel <id>` | → `cancelled` |
| `pablay archive <id>` | 소프트 삭제 |
| `pablay log <id>` | 상태 전환 이력 |
| `pablay children <id>` | 직접 자식 메시지 |
| `pablay thread <id>` | 메시지 + 자식 + 참조 |
| `pablay channels` | 활성 채널과 메시지 수 |
| `pablay sync` | 마크다운 편집 내용을 SQLite에 반영 |
| `pablay sync --rebuild` | 마크다운 파일로부터 SQLite 재구성 |
| `pablay export` | 모든 메시지를 NDJSON으로 스트리밍 |
| `pablay export --format md` | `.pablay/messages/`의 tar 아카이브 스트리밍 |

stdin으로 본문 전달: `cat notes.md | pablay create note --title "컨텍스트"`

## 에이전트 연동

메시지 귀속이 올바르게 되도록 안정적인 작성자 이름을 설정합니다:

```bash
export PABLAY_AUTHOR=claude-code
```

기계 읽기용 출력에는 `--json`을 사용합니다 (전역 플래그로 명령 앞에 위치):

```bash
pablay --json feed
pablay --json list --type task --status open
pablay --json show <id>
```

크로스 프로젝트 협업에는 `--global`을 사용합니다:

```bash
pablay --global feed
pablay --global create note --title "프로젝트 A에서 인계"
```

에이전트별 설정 안내: [`CLAUDE.md`](CLAUDE.md) (Claude Code) · [`AGENTS.md`](AGENTS.md) (Codex 등)

## 관찰 가능성

OpenTelemetry는 기본적으로 비활성화되어 있습니다. `.pablay/config.json`에서 활성화합니다:

```json
{
  "otel": {
    "exporter": "otlphttp",
    "endpoint": "http://localhost:4318"
  }
}
```

설정하면 pablay는 명령 스팬, 메시지 생성 카운터, 상태 전환 이벤트를 OTEL 콜렉터(Jaeger, Grafana 등)로 전송합니다.

## 로드맵

Pablay는 현재 CLI 전용입니다. 계획 중: 에이전트 활동을 실시간으로 시각화하는 메트릭 대시보드와 Kanban 보드.

## 라이선스

MIT — [LICENSE](LICENSE) 참조.
