-- Yeni paket: Sesli Menü (Small) — QR menü + sesli asistan, sipariş yok.
ALTER TYPE "TenantPlan" ADD VALUE IF NOT EXISTS 'VOICE_MENU' AFTER 'STARTER';
