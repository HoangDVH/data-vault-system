# Architecture & Design Decisions — Narrative

---

## 1. Technical Choices

### 1.1 Architectural Decision: Hard Isolation via Iframe + Message Bus

Thay vì sử dụng shared state hoặc gọi API trực tiếp, tôi chủ động thiết kế hệ thống theo hướng **hard isolation**:

- **Main App** → chỉ chịu trách nhiệm UI/UX  
- **Data Vault (iframe)** → chịu trách nhiệm data processing & storage  

Hai bên giao tiếp thông qua một **asynchronous message bus** (`postMessage`).

**Lý do chiến lược:**

- **Enforced separation of concerns (SoC)** — UI layer hoàn toàn không phụ thuộc vào data layer → dễ maintain và scale  
- **Security boundary rõ ràng** — Iframe tạo ra sandbox tự nhiên → giảm nguy cơ data leakage / XSS escalation  
- **Extensibility** — Kiến trúc này có thể evolve thành Web Worker (compute-heavy), Remote service (microservice thật), mà không thay đổi contract  

**Trade-off:**

| Option | Pros | Cons |
|--------|------|------|
| Direct DB access | Simple | Vi phạm đề bài, coupling cao |
| REST API | Clear | Overhead network + không phù hợp local |
| **Iframe Messaging (chosen)** | Isolation + async + realistic | Phức tạp hơn, cần protocol |

→ Tôi chấp nhận complexity để đổi lấy scalability + correctness + design purity.

---

### 1.2 Messaging Protocol Design (Not Just postMessage)

Thay vì dùng raw `postMessage`, tôi thiết kế một **application-level protocol**:

```ts
type Request = {
  id: string
  type: string
  payload: unknown
  timestamp: number
}

type Response = {
  id: string
  status: "success" | "error"
  data?: unknown
  error?: string
}
```

**Design considerations:**

- **Idempotency & traceability** — `id` giúp mapping request–response → tránh race condition  
- **Loose coupling** — `type` hoạt động như command → dễ mở rộng (`SEARCH`, `BULK_INSERT`, …)  
- **Debuggability** — Có thể log toàn bộ message flow như một event stream  

**Advanced thinking:** Tôi xem message bus này như một **mini event-driven system** trong browser, không chỉ là communication đơn thuần.

*(Trong repo: contract chi tiết hơn — version, HMAC, skew timestamp — xem `shared/vaultProtocol.ts`.)*

---

### 1.3 Data Layer: IndexedDB as a Client-side Database

**Tại sao không dùng:**

- **LocalStorage** → synchronous, blocking  
- **In-memory array** → không scale, mất data khi reload  

**Chọn IndexedDB vì:**

- Async → không block UI thread  
- Native indexing → query nhanh  
- Designed cho large dataset (500k+ records)  

**Quan điểm:** Tôi không coi IndexedDB là storage đơn thuần, mà là **“client-side database engine”** → nên thiết kế data access theo hướng:

- Query-based (không scan toàn bộ)  
- Index-first thinking  

---

### 1.4 Search Strategy: From Linear Scan → Indexed Query

**Approach ban đầu (naive):**

```ts
data.filter(...)
```

→ Complexity: **O(n)**

**Vấn đề:**

- Với 500k records → không thể đạt &lt;100ms  
- CPU bound → drop FPS  

**Approach cuối:**

- Tạo index trong IndexedDB  
- Normalize data (lowercase, tokenize nếu cần)  
- Query trực tiếp trên index  

**Insight:** Thay vì tối ưu code, tôi thay đổi **data access pattern**.

> “You don’t optimize O(n), you eliminate it.”

---

### 1.5 Rendering Strategy: Virtualization as a First-class Concern

**Vấn đề:** DOM không thể handle hàng trăm nghìn node.

**Giải pháp:** Windowing / Virtualization.

**Tư duy:** Tôi không xem đây là optimization, mà là **requirement bắt buộc**.

- Render size = **O(visible items)**, không phải O(total items)  
- Giữ stable FPS  

---

### 1.6 Bulk Insert: Cooperative Scheduling

**Vấn đề:** Insert 50k records → block event loop → UI freeze.

**Giải pháp:**

- Chunking (batch size: ~500–1000)  
- Yield control về main thread  

```text
for (chunk of chunks) {
  await insert(chunk)
  await yield()
}
```

**Tư duy:** Thay vì cố làm nhanh hơn, tôi làm cho: **“Work cooperatively with the browser scheduler.”**

*(Trong repo: bulk được chia trong **worker** với slice lớn hơn và `setTimeout(0)` giữa các slice — không nhất thiết cùng con số chunk với ví dụ trên.)*

---

## 2. Optimization

### 2.1 From Blocking → Non-blocking System

**Trạng thái ban đầu:** Bulk insert block UI, search lag.

**Chuyển đổi:** Async everywhere, chunk processing, indexed query.

→ Hệ thống chuyển từ **CPU-bound blocking** → **event-driven non-blocking**.

---

### 2.2 Latency Optimization (&lt;100ms requirement)

**Bottleneck chính:** Data scan, re-render.

**Giải pháp:**

- Eliminate linear scan (IndexedDB index)  
- Debounce input  
- Virtualized rendering  

**Kết quả (mục tiêu thiết kế):**

| Operation | Before | After |
|-----------|--------|--------|
| Search | 300–500ms | &lt;100ms |
| Render | lag | smooth |

---

### 2.3 Concurrency Control (Race Condition)

**Vấn đề:** Multiple async requests → response không đúng thứ tự.

**Giải pháp:**

- Request ID mapping  
- Pending promise registry — `pending[id] = resolve`  

**Insight:** Tôi xử lý vấn đề này giống như trong distributed system:

> “Out-of-order response is the norm, not the exception.”

---

### 2.4 Memory & Resource Optimization

- Không giữ full dataset trong React state  
- Delegate toàn bộ data cho Data Vault  
- Main App chỉ giữ: visible data, UI state  

→ Giảm memory pressure trên UI thread.

---

## 3. AI Usage & Critical Thinking

### 3.1 AI được sử dụng như một “Assistant”, không phải “Decision Maker”

Tôi sử dụng AI cho:

- Boilerplate generation  
- Suggest API usage (IndexedDB, postMessage)  
- Debug hints  

Nhưng mọi quyết định cuối cùng đều dựa trên:

- Benchmark thực tế  
- Complexity analysis  
- Browser behavior  

---

### 3.2 Case Study: AI đưa ra giải pháp chưa tối ưu

**AI đề xuất:**

```ts
data.filter(item => item.name.includes(keyword))
```

**Phân tích:**

- Complexity: O(n)  
- Không scale với 500k records  
- Không tận dụng index  

→ Đây là solution “correct” nhưng không production-grade.

---

### 3.3 Cách tôi phản biện & điều chỉnh

1. **Measure:** Test với dataset lớn  
2. **Identify bottleneck:** CPU bound  
3. **Redesign:** Move search xuống IndexedDB, index-based query  

*(Đối chiếu implementation hiện tại: worker + `nameLc` + phân trang — trade-off đã ghi trong `DECISION_LOG.md`.)*

---

### 3.4 Meta Insight về AI

AI tối ưu cho: local problems, code snippets.

AI yếu ở: system-level trade-offs, performance constraints thực tế.

→ Tôi sử dụng AI theo nguyên tắc:

> “Trust, but verify. Then redesign if needed.”

---

## 4. Final Reflection

Hệ thống này không chỉ giải bài toán “làm được”, mà tập trung vào:

- **Correctness under constraint** (no direct DB access)  
- **Performance at scale** (500k+ records, &lt;100ms)  
- **Resilience** (non-blocking UI, async messaging)  
- **Extensibility** (có thể evolve thành distributed system)  

**Điểm cốt lõi tôi hướng tới:**

Thiết kế hệ thống như thể nó sẽ phải scale trong production, không phải chỉ để demo.
