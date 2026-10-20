<div dir="rtl" align="right">

# المساهمة في Vim Layout Switch

شكرًا لاهتمامك بالمساهمة! هذا المستند يشرح كيف تبدأ.

## قبل أن تبدأ

- افتح **Issue** أولًا لأي تغيير كبير (ميزة جديدة أو إعادة هيكلة) حتى نتفق على الاتجاه.
- للبلاغات الصغيرة والإصلاحات الواضحة، يمكنك إرسال Pull Request مباشرة.

## بيئة التطوير

```bash
git clone https://github.com/BaselCS/obsidian-vim-layout-switch.git
cd obsidian-vim-layout-switch
npm install
npm run dev
```

`npm run dev` يراقب `src/` ويعيد بناء `main.js` عند كل تعديل. انسخ `main.js` و`manifest.json` إلى مجلد الإضافة في خزنتك التجريبية ثم أعد تحميل Obsidian.

## معايير الكود

- TypeScript صارم (`strictNullChecks` مفعّل) وبلا `any` غير مبرّر.
- تجنّب الاعتماد على واجهات Obsidian غير الموثّقة إن أمكن، وإن اضطررت فاعزل الوصول في دالة مساعدة مع تعليق يشرح السبب.
- استخدم `execFile` مع مصفوفة معاملات بدلًا من `exec` مع سلسلة نصية لتجنّب حقن الأوامر.
- لا تُرسل أي بيانات للشبكة. الإضافة تعمل محليًا بالكامل.
- احترم مديري النوافذ المدعومين فقط (Hyprland، Sway) وأضف تعاملًا واضحًا مع الحالات غير المدعومة.

## قبل إرسال Pull Request

```bash
npm run build
```

يجب أن ينجح دون أخطاء. بعدها:

1. حدّث `CHANGELOG.md` تحت قسم `Unreleased`.
2. اذكر في وصف الـ PR: ما الذي تغيّر، ومدير النوافذ الذي اختبرت عليه، وخطوات الاختبار.
3. اربط الـ PR بالـ Issue ذي الصلة إن وُجد.

## قوالب البلاغات

- [بلاغ خطأ](https://github.com/BaselCS/obsidian-vim-layout-switch/issues/new?template=bug_report.yml)
- [اقتراح ميزة](https://github.com/BaselCS/obsidian-vim-layout-switch/issues/new?template=feature_request.yml)

## الرخصة

بمساهمتك فإنك توافق على نشر تعديلاتك تحت رخصة MIT.

</div>
