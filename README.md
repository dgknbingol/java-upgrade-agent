# Java Upgrade Agent

Maven tabanlı Java projelerini Copilot CLI kullanarak hedef Java sürümüne (varsayılan: 21) yükselten web uygulaması.

## Dağıtım modeli: Merkezi UI + Lokal Agent

Şirkette hedeflenen kullanım:

| Bileşen | Nerede çalışır |
|---------|----------------|
| **Frontend (UI)** | OpenShift — tüm ekipler aynı adresi açar |
| **Backend (agent)** | Her geliştiricinin **kendi laptop'unda** |

Yazılımcı merkezi UI'ı açar, Git URL girer, **Yükseltmeyi Başlat** der. Tarayıcı `http://localhost:4000` üzerinden **o kişinin bilgisayarındaki** backend'e istek atar:

1. Repo **lokal workspace**'e klonlanır (`backend/workspaces/{jobId}` veya seçilen klasör)
2. **Copilot CLI** aynı makinede çalışır
3. `mvn clean install` lokalde çalışır
4. **Push Branch** ile değişiklikler **lokalden** Git'e gider

OpenShift backend pod'una git/copilot/mvn kurulması gerekmez. Workspace birikimi de merkezi sunucuda değil, geliştirici makinesinde olur.

### Geliştirici kurulumu (ekip üyesi)

```bash
cd backend && npm install && npm run dev
```

UI OpenShift'teyken frontend build'inde `VITE_API_BASE=http://localhost:4000` kullanılır (varsayılan). Config Server'dan backend `server.cors.origin` değerine merkezi UI URL'si verilir.

> **Not:** HTTPS merkezi UI → HTTP localhost çağrısında tarayıcı kısıtı olabilir. Sorun yaşanırsa frontend'i de lokal çalıştırın (`npm run dev`) veya IT ile loopback/Private Network Access politikasını netleştirin.

## Gereksinimler

Aşağıdaki araçlar geliştirici laptop'unda **PATH** üzerinde olmalı. Lokal agent'ı hangi terminalden başlatırsanız, o terminalin PATH'i kullanılır.

| Araç | Kontrol | Windows kurulum |
|------|---------|-----------------|
| Git | `git --version` | [git-scm.com](https://git-scm.com/download/win) |
| Maven | `mvn --version` | `choco install maven -y` (yönetici PowerShell) |
| Copilot CLI | `copilot --version` | `npm install -g @github/copilot` (Node.js 22+ gerekir) |
| Java JDK 21 | `java --version` | `winget install EclipseAdoptium.Temurin.21.JDK` |

Kurulumdan sonra **terminali kapatıp yeniden açın**. Cursor içinden çalıştırıyorsanız **Cursor'u tamamen kapatıp yeniden açın** (Chocolatey PATH'i ancak o zaman yüklenir). Ardından backend'i başlatın:

```powershell
where git
where mvn
where copilot
where java
```

Uygulama açıldığında eksik araçlar sarı uyarı kutusunda listelenir.

## Proje Yapısı

```
java-upgrade-agent/
├── frontend/          # React + Vite + TypeScript (port 5173)
├── backend/           # Node.js + Express + TypeScript (port 4000)
│   ├── config/
│   │   ├── application.properties      # Yerel varsayılan ayarlar + Copilot promptları
│   │   └── application-local.properties  # Opsiyonel (gitignore)
│   ├── src/
│   │   ├── server.ts
│   │   ├── jobRunner.ts
│   │   └── config/                     # Properties + Config Server yükleyici
│   └── workspaces/    # Klonlanan repolar (job başına bir klasör)
└── README.md
```

## Kurulum

### Backend

```bash
cd backend
npm install
```

### Frontend

```bash
cd frontend
npm install
```

## Çalıştırma

İki ayrı terminalde:

**Backend (port 4000):**

```bash
cd backend
npm run dev
```

**Frontend (port 5173):**

```bash
cd frontend
npm run dev
```

Tarayıcıda [http://localhost:5173](http://localhost:5173) adresini açın.

## Kullanım

1. Git repository URL ve kaynak branch girin.
2. **Analiz Et** ile projenin güncel Java sürümünü tespit edin (pom.xml, Dockerfile, CI).
3. Güncel ve hedef sürüm karşılaştırması göründükten sonra hedef Java sürümünü ayarlayın.
4. **Yükseltmeyi Başlat** ile işi başlatın:
   - Repo `backend/workspaces/{jobId}` altına klonlanır
   - Kaynak branch checkout edilir
   - `feature/java-{version}-upgrade` branch'i oluşturulur (sürüm formdaki hedef Java değerinden alınır; isim doluysa `-2`, `-3` ... eklenir)
   - Copilot CLI migration prompt ile çalıştırılır
   - `mvn clean install` çalıştırılır
3. Canlı loglar ve job durumu SSE ile akar.
4. **Run Build** ile Maven build'i yeniden çalıştırın.
5. **Push Branch** ile upgrade branch'ini origin'e push edin (otomatik push yapılmaz).

## Yapılandırma (application.properties)

Node.js tarafında Spring Boot'taki `application.properties` karşılığı `backend/config/application.properties` dosyasıdır.

**Yükleme sırası** (sonraki öncekini ezer):

1. `config/application.properties` — repoda, yerel varsayılanlar
2. `config/application-local.properties` — opsiyonel, kişisel ayarlar (git'e eklenmez)
3. **Spring Cloud Config Server** — OpenShift ortamında merkezi ayarlar

OpenShift'te frontend ve backend ayrı deployment olarak çalışır; elle terminal komutu gerekmez. Backend pod'u ayağa kalkarken Config Server bağlantısı platform üzerinden verilir (Deployment/ConfigMap/Secret ile `SPRING_CLOUD_CONFIG_URI`, `SPRING_APPLICATION_NAME`, `SPRING_PROFILES_ACTIVE`). Aynı anahtarlar `application.properties` içinde de tanımlanabilir; pod env değerleri bunların üzerine yazar.

Config Server git repo'nuzda `java-upgrade-agent.properties` (veya profile dosyası) tutar; backend başlarken otomatik çeker. Yerelde Config Server yoksa yalnızca `application.properties` kullanılır.

### Önemli anahtarlar

| Anahtar | Açıklama |
|---------|----------|
| `server.port` | Backend portu (OpenShift `PORT` env ile de override edilir) |
| `server.cors.origin` | Frontend CORS origin (OpenShift'te Config Server'dan; `SERVER_CORS_ORIGIN` env ile de verilebilir) |
| `job.max-build-fix-attempts` | Maven build + Copilot düzeltme döngüsü |
| `job.upgrade-branch-pattern` | Branch şablonu (`{version}` placeholder) |
| `prompt.java-upgrade` | Migration prompt şablonu (Config Server'da düzenlenir) |
| `prompt.maven-fix` | Build hata düzeltme prompt şablonu |
| `prompt.java-upgrade.file` | İsteğe bağlı: prompt'u dosyadan okumak için |
| `prompt.maven-fix.file` | İsteğe bağlı: prompt'u dosyadan okumak için |

Prompt dosyalarında `{targetJavaVersion}`, `{sourceJavaVersion}`, `{sourceLine}`, `{buildLog}` placeholder'ları kullanılır.

Yüklü ayarları görmek için: `GET http://localhost:4000/api/config`

## API

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/config` | Aktif yapılandırma özeti |
| POST | `/api/analyze` | Repo + branch için Java sürümü tespit et |
| POST | `/api/jobs/start` | Yeni upgrade job başlat |
| GET | `/api/jobs/:jobId/events` | SSE log/status stream |
| GET | `/api/jobs/:jobId/report` | MIGRATION_REPORT.md |
| GET | `/api/jobs/:jobId/diff` | Git diff |
| POST | `/api/jobs/:jobId/build` | mvn clean install |
| POST | `/api/jobs/:jobId/push` | Branch push |

## Copilot CLI

Uygulama `copilot` komutunu PATH üzerinden çalıştırır. Non-interactive modda dosya düzenlemesi için şu bayraklar kullanılır: `--allow-all-tools`, `--no-ask-user`, `--autopilot`.

İlk kullanımda terminalde `copilot` çalıştırıp GitHub hesabınızla giriş yapın (`/login`). Aktif bir Copilot aboneliği gerekir.

```powershell
npm install -g @github/copilot
copilot -p "pom.xml dosyasını oku" --allow-all-tools --no-ask-user
```

**Boş diff:** `spring-petclinic-ai-java-upgrade` gibi repolar zaten Java 21 üzerinde olduğu için Copilot değişiklik yapmayabilir; bu durumda build yine geçer. Gerçek migration testi için Java 17 kaynaklı bir repo kullanın.

Farklı bir binary kullanmanız gerekiyorsa `backend/config/application.properties` içinde `copilot.command` değerini değiştirin.

## Notlar

- Job verileri bellekte tutulur; backend yeniden başlatılınca kaybolur.
- Workspace klasörleri diskte kalır (`backend/workspaces/`).
- Sadece Maven projeleri desteklenir; Gradle desteklenmez.
