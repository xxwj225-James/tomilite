# i18n Translation Checklist — 6 Languages

> Note: Historical working note — this inventory records the i18n key table as it stood during the translation sprint. The English strings are authoritative; the ja column is transliterated to romaji.

## Status — i18n conversion COMPLETE

The keyed-dictionary refactor is done:

- **Canonical API**: `t(key, lang, params?)` in `apps/web/src/lib/i18n.ts` with `en` / `zh` / `ja` values and `{placeholder}` interpolation. Supported languages: **en, zh, ja**; `th` / `mi` / `ru` are reserved for future use and currently fall back to `en`.
- **Key prefixes in use**: `chat.*`, `menu.*`, `pin.*`, `btn.*`, `dialog.*`, `staged.*`, `home.*`, `health.*`, `notes.*`, `tasks.*`, `reports.*`, `settings.*`, `feedback.*`, `emailTab.*`, `gitTab.*`, `standupTab.*`, `emailForm.*`, `md.*`, `update.*`, `evening.*`, `misc.*`, `emailList.*`, `emailPanel.*`, `emailDetail.*`, `mcp.*`, `llmTab.*`, `app.*` (welcome), `delete.*`, `editor.*`, `agent.*`, `export.*`, `report.*`.
- **Old helpers**: `apps/web/src/i18n/useT.ts` was **deleted** in the refactor (commit `1949274`). `tr()` still exists in `i18n.ts` as a backward-compat shim (used by a few panels), and `_t` / `_l` survive only as **local** helpers inside `components/chat/Msg.tsx` — new code should call `t(key, lang)`.
- All rows in the tables below correspond to implemented keys (en/zh/ja). The Setup Wizard rows (section 10) are historical — the Setup Wizard was removed in v1.0.3 and replaced by the Welcome Guide.

Status: ✅ = translated, ⚠️ = English fallback, ❌ = missing key

## 1. Chat Area

| English             | zh                  | ja                       | th                            | mi                         | ru                          |
| ------------------- | ------------------- | ------------------------ | ----------------------------- | -------------------------- | --------------------------- |
| Ask me anything...  | Ask me anything...  | nandemo kiite kudasai... | ถามอะไรก็ได้...               | Pātai mai...               | Спросите что угодно...      |
| Thinking...         | Thinking...         | kangaichu...             | กำลังคิด...                   | E whakaaro ana...          | Думаю...                    |
| Welcome to TomiLite | Welcome to TomiLite | TomiLite AI agent        | ยินดีต้อนรับสู่ TomiLite      | Nau mai ki TomiLite        | Добро пожаловать в TomiLite |
| Send                | Send                | soshin                   | ส่ง                           | Tuku                       | Отправить                   |
| New line            | New line            | kaigyo                   | บรรทัดใหม่                    | Rārangi hou                | Новая строка                |
| Compress            | Compress            | asshuku                  | บีบอัด                        | Whakarāpopoto              | Сжать                       |
| Clear               | Clear               | kuria                    | ล้าง                          | Whakawātea                 | Очистить                    |
| Download            | Download            | daunro-do                | ดาวน์โหลด                     | Tikiake                    | Скачать                     |
| Upload file         | Upload file         | fairu o appuro-do        | อัปโหลดไฟล์                   | Tukuatu kōnae              | Загрузить файл              |
| ✅ Apply            | ✅ Apply            | ✅ tekiyo                | ✅ นำไปใช้                    | ✅ Whakahono               | ✅ Применить                |
| ↩ Undo              | ↩ Undo              | ↩ moto ni modosu         | ↩ ยกเลิก                      | ↩ Whakakore                | ↩ Отменить                  |
| 📌 Pin to top       | 📌 Pin to top       | 📌 pintome               | 📌 ปักหมุด                    | 📌 Titi                    | 📌 Закрепить                |
| 📌 Pinned           | 📌 Pinned           | 📌 pintomechu            | 📌 ปักหมุดแล้ว                | 📌 Kua Titi                | 📌 Закреплено               |
| Unpin               | Unpin               | pintome kaijo            | เลิกปักหมุด                   | Wetekina                   | Открепить                   |
| 👁 View              | 👁 View              | 👁 hyoji                  | 👁 ดู                          | 👁 Tiro                     | 👁 Смотр.                    |
| ✏️ Edit             | ✏️ Edit             | ✏️ henshu                | ✏️ แก้ไข                      | ✏️ Whakatika               | ✏️ Правка                   |
| 🗑 Delete            | 🗑 Delete            | 🗑 sakujo                 | 🗑 ลบ                          | 🗑 Mukua                    | 🗑 Удалить                   |
| 📥 Save As          | 📥 Save As          | 📥 namae o tsukete hozon | 📥 บันทึกเป็น                 | 📥 Tiaki Hei               | 📥 Сохранить как            |
| Force Create        | Force Create        | kyosei sakusei           | บังคับสร้าง                   | Waihanga                   | Принудительно               |
| Cancel              | Cancel              | kyanseru                 | ยกเลิก                        | Whakakore                  | Отмена                      |
| Restart Now         | Restart Now         | ima sugu saikido         | รีสตาร์ทตอนนี้                | Whakaara Ināianei          | Перезапустить               |
| Unsaved Changes     | Unsaved Changes     | hozon sarete inai henko  | การเปลี่ยนแปลงที่ไม่ได้บันทึก | Ngā Panoni Kāore i Tiakina | Несохранённые изменения     |
| Leave               | Leave               | hanareru                 | ออก                           | Wehe                       | Выйти                       |
| Delete              | Delete              | sakujo                   | ลบ                            | Mukua                      | Удалить                     |
| Title:              | Title:              | taitoru:                 | ชื่อเรื่อง：                  | Taitara：                  | Заголовок：                 |
| Preview:            | Preview:            | purebyu:                 | ดูตัวอย่าง：                  | Arokite：                  | Предпросмотр：              |
| Desc:               | Desc:               | setsumei:                | คำอธิบาย：                    | Whakaahuatanga：           | Описание：                  |
| Status:             | Status:             | sutatasu:                | สถานะ：                       | Tūnga：                    | Статус：                    |
| Priority:           | Priority:           | yusendo:                 | ลำดับ：                       | Mātāmua：                  | Приоритет：                 |

## 2. Menu Bar

| English     | zh          | ja              | th          | mi           | ru          |
| ----------- | ----------- | --------------- | ----------- | ------------ | ----------- |
| Home        | Home        | homu            | หน้าแรก     | Kāinga       | Главная     |
| Tasks       | Tasks       | tasuku          | งาน         | Mahi         | Задачи      |
| Notes       | Notes       | noto            | บันทึก      | Tuhipoka     | Заметки     |
| Email       | Email       | meru            | อีเมล       | Īmēra        | Почта       |
| MCP Approve | MCP Approve | MCP shonin      | ตรวจสอบ MCP | Arotake MCP  | Аудит MCP   |
| Reports     | Reports     | repoto          | รายงาน      | Pūrongo      | Отчёты      |
| Feedback    | Feedback    | fidobakku       | ข้อเสนอแนะ  | Urupare      | Отзывы      |
| Settings    | Settings    | settei          | การตั้งค่า  | Tautuhinga   | Настройки   |
| + New Chat  | + New Chat  | + shinki chatto | + แชทใหม่   | + Kōrero Hou | + Новый чат |

## 3. Home Panel

| English                                | zh                                     | ja                                    | th                      | mi                                    | ru                            |
| -------------------------------------- | -------------------------------------- | ------------------------------------- | ----------------------- | ------------------------------------- | ----------------------------- |
| 📊 Task Statistics                     | 📊 Task Statistics                     | 📊 tasuku tokei                       | 📊 สถิติงาน             | 📊 Tauanga Mahi                       | 📊 Статистика                 |
| Total                                  | Total                                  | gokei                                 | รวม                     | Tapeke                                | Всего                         |
| Done                                   | Done                                   | kanryo                                | เสร็จ                   | Kua Oti                               | Готово                        |
| Rate                                   | Rate                                   | kanryoritsu                           | อัตรา                   | Ōrau                                  | Процент                       |
| 7d Done                                | 7d Done                                | 7-nichi-kan kanryo                    | 7 วัน                   | 7 Rā                                  | 7 дн.                         |
| Priority                               | Priority                               | yusendo bunpu                         | การกระจายลำดับ          | Tuari                                 | Приоритет                     |
| Completion                             | Completion                             | tasseido                              | ความสำเร็จ              | Whakaoti                              | Завершение                    |
| Velocity                               | Velocity                               | sokudo                                | ความเร็ว                | Tere                                  | Скорость                      |
| Focus                                  | Focus                                  | shuchu                                | โฟกัส                   | Arotahi                               | Фокус                         |
| Git                                    | Git                                    | Git akutibiti                         | กิจกรรม Git             | Ngohe Git                             | Активность Git                |
| Freshness                              | Freshness                              | sendo                                 | ความใหม่                | Houtanga                              | Свежесть                      |
| ❤️ My Health Score                     | ❤️ My Health Score                     | ❤️ herusu sukoa                       | ❤️ คะแนนสุขภาพ          | ❤️ Hauora                             | ❤️ Здоровье                   |
| Refresh                                | Refresh                                | koshin                                | รีเฟรช                  | Whakahou                              | Обновить                      |
| 🧠 Knowledge Map                       | 🧠 Knowledge Map                       | 🧠 narejji mappu                      | 🧠 แผนที่ความรู้        | 🧠 Mahere Mātauranga                  | 🧠 Карта знаний               |
| AI-generated from your tasks and notes | AI-generated from your tasks and notes | AI ga tasuku to noto kara jido seisei | AI สร้างจากงานและบันทึก | AI i hanga mai i ō mahi me ō tuhipoka | AI создано из задач и заметок |
| Loading...                             | Loading...                             | yomikomichu...                        | กำลังโหลด...            | E uta ana...                          | Загрузка...                   |

## 4. Notes Panel

| English                                         | zh                                              | ja                                                  | th                               | mi                                               | ru                               |
| ----------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- | -------------------------------- | ------------------------------------------------ | -------------------------------- |
| 🔍 Search notes...                              | 🔍 Search notes...                              | 🔍 noto kensaku...                                  | 🔍 ค้นหาบันทึก...                | 🔍 Rapu tuhipoka...                              | 🔍 Поиск...                      |
| + New                                           | + New                                           | + shinki                                            | + ใหม่                           | + Hou                                            | + Новый                          |
| Export selected                                 | Export selected                                 | sentaku o ekusupoto                                 | ส่งออกที่เลือก                   | Whakaputa                                        | Экспорт                          |
| Refresh list                                    | Refresh list                                    | risuto koshin                                       | รีเฟรชรายการ                     | Whakahou                                         | Обновить                         |
| Title                                           | Title                                           | taitoru                                             | ชื่อเรื่อง                       | Taitara                                          | Заголовок                        |
| Category                                        | Category                                        | kategori                                            | หมวดหมู่                         | Kāwai                                            | Категория                        |
| Updated                                         | Updated                                         | koshin                                              | อัปเดต                           | Whakahoutia                                      | Обновлено                        |
| Click to sort                                   | Click to sort                                   | kurikku de soto                                     | คลิกเพื่อเรียง                   | Pāwhiria hei kōmaka                              | Нажмите для сортировки           |
| General                                         | General                                         | ippan                                               | ทั่วไป                           | Whānui                                           | Общее                            |
| Architecture                                    | Architecture                                    | akitekucha                                          | สถาปัตยกรรม                      | Hoahoa                                           | Архитектура                      |
| API Docs                                        | API Docs                                        | API dokyumento                                      | เอกสาร API                       | Tuhinga API                                      | API Документы                    |
| Runbook                                         | Runbook                                         | ranbukku                                            | คู่มือ                           | Pukapuka                                         | Руководство                      |
| ← Back                                          | ← Back                                          | ← modoru                                            | ← กลับ                           | ← Hoki                                           | ← Назад                          |
| Note title                                      | Note title                                      | noto taitoru                                        | ชื่อบันทึก                       | Taitara Tuhipoka                                 | Заголовок                        |
| Write your note... (Markdown supported)         | Write your note... (Markdown supported)         | noto o kaku... (Markdown taio)                      | เขียนบันทึก... (รองรับ Markdown) | Tuhia tō tuhipoka...                             | Пишите заметку... (Markdown)     |
| ✨ Pol                                          | ✨ Pol                                          | ✨ suiko                                            | ✨ ขัดเกลา                       | ✨ Whakapaipai                                   | ✨ Обработка                     |
| 🌐 Tran                                         | 🌐 Tran                                         | 🌐 honyaku                                          | 🌐 แปล                           | 🌐 Whakamāori                                    | 🌐 Перевод                       |
| 📝 Sum                                          | 📝 Sum                                          | 📝 yoyaku                                           | 📝 สรุป                          | 📝 Whakarāpopoto                                 | 📝 Итог                          |
| 📖 Exp                                          | 📖 Exp                                          | 📖 kakucho                                          | 📖 ขยาย                          | 📖 Whakawhānui                                   | 📖 Расширить                     |
| Save                                            | Save                                            | hozon                                               | บันทึก                           | Tiaki                                            | Сохранить                        |
| Saving...                                       | Saving...                                       | hozonchu...                                         | กำลังบันทึก...                   | E tiaki ana...                                   | Сохранение...                    |
| Delete                                          | Delete                                          | sakujo                                              | ลบ                               | Mukua                                            | Удалить                          |
| Delete Note                                     | Delete Note                                     | noto sakujo                                         | ลบบันทึก                         | Mukua Tuhipoka                                   | Удалить заметку                  |
| Delete this note? This action cannot be undone. | Delete this note? This action cannot be undone. | kono noto o sakujo shimasu ka? Moto ni modosemasen. | ลบบันทึกนี้? ไม่สามารถยกเลิกได้  | Mukua tēnei tuhipoka? Kāore e taea te whakakore. | Удалить заметку? Это необратимо. |
| Save Failed                                     | Save Failed                                     | hozon shippai                                       | บันทึกล้มเหลว                    | Tiaki Rāhua                                      | Ошибка сохранения                |
| No notes yet.                                   | No notes yet.                                   | noto ga arimasen.                                   | ยังไม่มีบันทึก                   | Kāore anō he tuhipoka.                           | Нет заметок.                     |
| Untitled Note                                   | Untitled Note                                   | mudai noto                                          | บันทึกไม่มีชื่อ                  | Tuhipoka Kore Taitara                            | Заметка без названия             |
| Untitled                                        | Untitled                                        | mudai                                               | ไม่มีชื่อ                        | Kore Taitara                                     | Без названия                     |

## 5. Tasks Panel

| English       | zh            | ja                 | th                 | mi               | ru                |
| ------------- | ------------- | ------------------ | ------------------ | ---------------- | ----------------- |
| 🔍 Search...  | 🔍 Search...  | 🔍 kensaku...      | 🔍 ค้นหา...        | 🔍 Rapu...       | 🔍 Поиск...       |
| + New         | + New         | + shinki           | + ใหม่             | + Hou            | + Новый           |
| Delete        | Delete        | sakujo             | ลบ                 | Mukua            | Удалить           |
| Batch Delete  | Batch Delete  | ikkatsu sakujo     | ลบเป็นชุด          | Mukua Rōpū       | Массовое удаление |
| ✅ Task       | ✅ Task       | ✅ tasuku          | ✅ งาน             | ✅ Mahi          | ✅ Задача         |
| 🐛 Bug        | 🐛 Bug        | 🐛 bagu            | 🐛 บั๊ก            | 🐛 Hapa          | 🐛 Баг            |
| 📖 Story      | 📖 Story      | 📖 sutori          | 📖 สตอรี่          | 📖 Pūrākau       | 📖 История        |
| 📥 Email      | 📥 Email      | 📥 meru            | 📥 อีเมล           | 📥 Īmēra         | 📥 Почта          |
| Critical      | Critical      | kinkyu             | Critical           | Critical         | Critical          |
| High          | High          | ko                 | High               | High             | High              |
| Medium        | Medium        | chu                | Medium             | Medium           | Medium            |
| Low           | Low           | tei                | Low                | Low              | Low               |
| All Types     | All Types     | subete no shurui   | ทุกประเภท          | Ngā Momo Katoa   | Все типы          |
| All Priority  | All Priority  | subete no yusendo  | ทุกลำดับ           | Katoa            | Все               |
| All Status    | All Status    | subete no sutatasu | ทุกสถานะ           | Katoa            | Все               |
| Todo          | Todo          | Todo               | Todo               | Todo             | Todo              |
| In Progress   | In Progress   | shinkochu          | กำลังทำ            | Kei te Haere     | В процессе        |
| In Review     | In Review     | rebyuchu           | กำลังตรวจ          | Kei te Arotake   | На проверке       |
| Done          | Done          | kanryo             | เสร็จ              | Kua Oti          | Готово            |
| SP            | SP            | SP                 | SP                 | SP               | SP                |
| Created       | Created       | sakusei            | สร้าง              | Waihanga         | Создано           |
| Mark Done     | Mark Done     | kanryo maku        | ทำเครื่องหมายเสร็จ | Tohu Kua Oti     | Отметить готово   |
| Dismiss All   | Dismiss All   | subete kidoku      | ยกเลิกทั้งหมด      | Whakakore Katoa  | Отклонить все     |
| From          | From          | soshinsha          | จาก                | Nā               | От                |
| Send          | Send          | soshin             | ส่ง                | Tuku             | Отправить         |
| Sending...    | Sending...    | soshinchu...       | กำลังส่ง...        | E tuku ana...    | Отправка...       |
| Read Original | Read Original | genbun o yomu      | อ่านต้นฉบับ        | Pānui Taketake   | Читать оригинал   |
| Dismiss       | Dismiss       | tojiru             | ปิด                | Whakakore        | Отклонить         |
| AI Summary    | AI Summary    | AI samari          | สรุป AI            | Whakarāpopoto AI | AI Итог           |
| AI Draft      | AI Draft      | AI shitagaki       | ร่าง AI            | Tauira AI        | AI Черновик       |
| Cannot load   | Cannot load   | yomikomi shippai   | โหลดไม่ได้         | Kāore i taea     | Не загружено      |
| No-reply      | No-reply      | henshin fuyo       | ไม่ต้องตอบ         | Kaua e Whakautu  | Без ответа        |

## 6. Reports Panel

| English              | zh                   | ja                   | th                | mi                 | ru            |
| -------------------- | -------------------- | -------------------- | ----------------- | ------------------ | ------------- |
| 🔍 Search reports... | 🔍 Search reports... | 🔍 repoto kensaku... | 🔍 ค้นหารายงาน... | 🔍 Rapu pūrongo... | 🔍 Поиск...   |
| + Create             | + Create             | + sakusei            | + สร้าง           | + Waihanga         | + Создать     |
| View                 | View                 | hyoji                | ดู                | Tiro               | Смотр.        |
| 📝 Draft             | 📝 Draft             | 📝 shitagaki         | 📝 ร่าง           | 📝 Tauira          | 📝 Черновик   |
| 📤 Sent              | 📤 Sent              | 📤 soshinzumi        | 📤 ส่งแล้ว        | 📤 Kua Tukua       | 📤 Отправлено |
| ← Back               | ← Back               | ← modoru             | ← กลับ            | ← Hoki             | ← Назад       |
| Daily                | Daily                | nichiji              | รายวัน            | Ia Rā              | Дневной       |
| Weekly               | Weekly               | shuji                | รายสัปดาห์        | Ia Wiki            | Недельный     |
| Save                 | Save                 | hozon                | บันทึก            | Tiaki              | Сохранить     |
| Send                 | Send                 | soshin               | ส่ง               | Tuku               | Отправить     |
| Delete               | Delete               | sakujo               | ลบ                | Mukua              | Удалить       |
| Report title         | Report title         | repoto taitoru       | ชื่อรายงาน        | Taitara Pūrongo    | Заголовок     |
| Delete Report        | Delete Report        | repoto sakujo        | ลบรายงาน          | Mukua Pūrongo      | Удалить отчёт |

## 7. Settings Tabs

| English       | zh            | ja                 | th              | mi     | ru                 |
| ------------- | ------------- | ------------------ | --------------- | ------ | ------------------ |
| LLM           | LLM           | LLM                | LLM             | LLM    | LLM                |
| Keys          | Keys          | ki                 | กุญแจ           | Kī     | Ключи              |
| Email         | Email         | meru               | อีเมล           | Īmēra  | Почта              |
| Git           | Git           | Git                | Git             | Git    | Git                |
| Daily Standup | Daily Standup | deiri sutando appu | สแตนด์อัพรายวัน | Tū Ata | Ежедневный стендап |
| About         | About         | gaiyo              | เกี่ยวกับ       | Mō     | О программе        |

## 8. Feedback Panel

| English                      | zh                           | ja                           | th                      | mi                     | ru                 |
| ---------------------------- | ---------------------------- | ---------------------------- | ----------------------- | ---------------------- | ------------------ |
| 📬 Submit Feedback           | 📬 Submit Feedback           | 📬 fidobakku soshin          | 📬 ส่งข้อเสนอแนะ        | 📬 Tuku Urupare        | 📬 Отправить отзыв |
| 🐛 Bug Report                | 🐛 Bug Report                | 🐛 bagu hokoku               | 🐛 รายงานบั๊ก           | 🐛 Pūrongo Hapa        | 🐛 Отчёт об ошибке |
| 💡 Feature Request           | 💡 Feature Request           | 💡 kino rikuesuto            | 💡 คำขอฟีเจอร์          | 💡 Tono Āhuatanga      | 💡 Запрос функции  |
| 💬 Other                     | 💬 Other                     | 💬 sonota                    | 💬 อื่นๆ                | 💬 Ētahi Atu           | 💬 Другое          |
| Thank you for your feedback! | Thank you for your feedback! | fidobakku arigato gozaimasu! | ขอบคุณสำหรับข้อเสนอแนะ! | Ngā mihi mō ō urupare! | Спасибо за отзыв!  |
| Submit New Feedback          | Submit New Feedback          | atarashii fidobakku o soshin | ส่งข้อเสนอแนะใหม่       | Tuku Urupare Hou       | Новый отзыв        |
| 📨 Submit                    | 📨 Submit                    | 📨 soshin                    | 📨 ส่ง                  | 📨 Tuku                | 📨 Отправить       |

## 9. ConfirmDialogs

| English | zh      | ja       | th     | mi        | ru          |
| ------- | ------- | -------- | ------ | --------- | ----------- |
| Cancel  | Cancel  | kyanseru | ยกเลิก | Whakakore | Отмена      |
| Confirm | Confirm | kakunin  | ยืนยัน | Whakaū    | Подтвердить |
| OK      | OK      | OK       | ตกลง   | Āe        | OK          |
| Delete  | Delete  | sakujo   | ลบ     | Mukua     | Удалить     |

## 10. Setup Wizard

| English                   | zh                        | ja                    | th                          | mi                     | ru                             |
| ------------------------- | ------------------------- | --------------------- | --------------------------- | ---------------------- | ------------------------------ |
| Welcome to TomiLite 🎉    | Welcome to TomiLite 🎉    | TomiLite e yokoso 🎉  | ยินดีต้อนรับสู่ TomiLite 🎉 | Nau mai ki TomiLite 🎉 | Добро пожаловать в TomiLite 🎉 |
| Choose Language           | Choose Language           | gengo o sentaku       | เลือกภาษา                   | Kōwhiria te Reo        | Выберите язык                  |
| Email (Optional)          | Email (Optional)          | meru (nini)           | อีเมล (ไม่บังคับ)           | Īmēra (Kōwhiringa)     | Почта (опционально)            |
| LLM                       | LLM                       | LLM                   | LLM                         | LLM                    | LLM                            |
| Git Workspaces (Optional) | Git Workspaces (Optional) | Git wakusupesu (nini) | Git Workspace (ไม่บังคับ)   | Git (Kōwhiringa)       | Git (опционально)              |
| All Set! 🚀               | All Set! 🚀               | junbi kanryo! 🚀      | เสร็จแล้ว! 🚀               | Kua Rite! 🚀           | Готово! 🚀                     |
| Next →                    | Next →                    | tsugi e →             | ถัดไป →                     | Panuku →               | Далее →                        |
| ← Back                    | ← Back                    | ← modoru              | ← กลับ                      | ← Hoki                 | ← Назад                        |
| Start Using 🚀            | Start Using 🚀            | kaishi 🚀             | เริ่มใช้งาน 🚀              | Tīmata 🚀              | Начать 🚀                      |
| Skip                      | Skip                      | sukippu               | ข้าม                        | Hipa                   | Пропустить                     |
| Test Connection           | Test Connection           | setsuzoku tesuto      | ทดสอบการเชื่อมต่อ           | Whakamātau Hononga     | Проверить                      |
| Testing...                | Testing...                | tesutochu...          | กำลังทดสอบ...               | E whakamātau ana...    | Проверка...                    |
| ✅ Connected              | ✅ Connected              | ✅ setsuzoku seiko    | ✅ เชื่อมต่อแล้ว            | ✅ Kua Honohono        | ✅ Подключено                  |
| ❌ Failed                 | ❌ Failed                 | ❌ setsuzoku shippai  | ❌ ล้มเหลว                  | ❌ Rāhua               | ❌ Ошибка                      |
| API Key                   | API Key                   | API ki                | API Key                     | API Kī                 | API Ключ                       |
| Provider                  | Provider                  | purobaida             | ผู้ให้บริการ                | Kaiwhakarato           | Провайдер                      |
| + Add                     | + Add                     | + tsuika              | + เพิ่ม                     | + Tāpiri               | + Добавить                     |
| ✕                         | ✕                         | ✕                     | ✕                           | ✕                      | ✕                              |
