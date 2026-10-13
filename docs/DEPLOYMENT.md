# Deploy & Update Guide

Panduan update untuk web, Android, dan iOS. Ikuti sesuai platform yang mau di-update.

## Prasyarat

- Node.js 20.11+
- npm 10+
- Supabase project aktif (untuk sync)
- Untuk iOS: Mac dengan Xcode + CocoaPods
- Untuk Android: Android Studio

## 1. Update Web (Vercel)

Web auto-deploy dari branch `main`. Setelah commit + push, Vercel build otomatis.

```bash
git add -A
git commit -m "deskripsi perubahan"
git push origin main
```

Vercel auto-deploy. Cek status di dashboard Vercel atau:

```bash
npx vercel --prod
```

Production URL: `https://todowork.reip.my.id`

## 2. Update Mobile (Android & iOS)

Mobile pakai Capacitor. Web assets di-build ke `out/`, lalu di-copy ke native project.

### Langkah lengkap

```bash
# 1. Build web assets (generate out/)
npm run build

# 2. Copy + sync ke native project
npx cap sync
```

Atau satu perintah:

```bash
npm run cap:sync
```

### Buka native project

```bash
# Android — buka Android Studio
npx cap open android

# iOS — buka Xcode (Mac only)
npx cap open ios
```

### Build APK / AAB (Android)

1. `npx cap open android`
2. Android Studio → **Build** → **Build Bundle(s)/APK(s)** → **Build APK(s)**
3. Output: `android/app/build/outputs/apk/`

### Build IPA (iOS)

1. `npx cap open ios`
2. Xcode → pilih target **App** → signing & capabilities
3. **Product** → **Archive**
4. Output via Organizer → Distribute App

### Quick copy tanpa rebuild

Kalau cuma ubah native config (bukan web code):

```bash
npx cap copy android
npx cap copy ios
```

## 3. Checklist Update

| Step | Web | Android | iOS |
|------|-----|---------|-----|
| Edit code | yes | yes | yes |
| `npm run build` | skip (Vercel build) | yes | yes |
| `npx cap sync` | skip | yes | yes |
| `git push origin main` | yes (trigger Vercel) | optional | optional |
| Open native IDE | skip | yes | yes |
| Build / Archive | skip | yes | yes |

## 4. PWA Auto-Update

PWA auto-update tanpa manual refresh. Service worker (`public/sw.js`) handle:

- **Navigation** → network-first (selalu HTML terbaru)
- **Static assets** → stale-while-revalidate
- **New deploy** → SW detect update → `skipWaiting()` → auto-reload

User tidak perlu Ctrl+Shift+R. Buka app → auto-update.

## 5. Sync Cross-Device

Setelah deploy, sync antar device otomatis:

- **Realtime** (websocket) — butuh `setup_all.sql` sudah di-run di Supabase SQL Editor
- **Interval fallback** — setiap 30 detik cek perubahan
- **Triggers** — mount, online, visibility change, window focus

Device A edit → Device B auto-update dalam ~1 detik (realtime) atau ~30 detik (interval).

## 6. Troubleshooting

### Capacitor: "web assets directory must contain index.html"

`webDir` salah. Pastikan `capacitor.config.ts` pakai `webDir: 'out'`, lalu:

```bash
npm run build
npx cap sync
```

### iOS: "Skipping pod install"

CocoaPods belum terinstall:

```bash
brew install cocoapods   # atau sudo gem install cocoapods
npx cap sync ios
```

### Android: "capacitor.plugins.json not found"

Run sync ulang:

```bash
npx cap sync android
```

### SW error: "chrome-extension request scheme unsupported"

Sudah fixed di `sw.js` v2. Pastikan deploy terbaru sudah live.

### Sync tidak jalan cross-device

1. Pastikan `supabase/setup_all.sql` sudah di-run di Supabase SQL Editor
2. Cek Supabase Dashboard → Authentication → URL Configuration → Redirect URLs termasuk `https://todowork.reip.my.id/auth/callback`
3. Hard refresh sekali untuk load SW + JS terbaru
