# Pi Web X

Pi Web X — нативный Bun веб-интерфейс для [pi coding agent](https://github.com/earendil-works/pi). Он запускается как один исполняемый файл и использует общие данные сессий, моделей, аутентификации и расширений pi.

## Запуск

Скачайте бинарный файл для своей платформы из GitHub Release:

```bash
./pi-web-x
# http://127.0.0.1:30141
```

Для запуска бинарного файла не нужны Node.js или Bun. Для установки plugin/skill и части worktree-функций требуются git и npm/npx.

Используйте `PI_WEB_X_PASSWORD`, `PI_WEB_X_HOSTNAME` и `PI_WEB_X_ALLOWED_HOSTS`. При прослушивании не-loopback адреса обязательно задайте длинный случайный пароль и используйте HTTPS или доверенный VPN.

Подробности: [English documentation](./README.md) и [MIGRATION.md](./MIGRATION.md).

## Лицензия

[MIT](./LICENSE). Сохранены авторские права и лицензия исходного pi-web.
