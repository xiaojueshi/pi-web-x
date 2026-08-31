# Pi Web X

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md)

Pi Web X — локальный веб-интерфейс для [pi coding agent](https://github.com/earendil-works/pi), изначально рассчитанный на Bun. Он запускается как нативный исполняемый файл и использует существующие сессии, модели, учётные данные, расширения, skills, prompts и themes из pi.

> Pi Web X — независимая реализация на основе `pi-web@0.8.11` (`28bab3c`). Пространство имён продукта отделено: старые настройки браузера и session custom entries с префиксом `pi-web:*` не читаются и не переносятся.

## Возможности

- Один нативный файл для macOS, Linux (glibc/musl) и Windows на x64/arm64.
- React 19 CSR выполняется в браузере; сервер не использует Next.js, RSC, SSR или runtime Node.js.
- Сессии, потоковая работа Agent, файлы, Git/worktree, модели и учётные данные, plugins, skills, prompts, themes, subagents и PWA.
- По умолчанию сервер слушает только loopback и проверяет Host/Origin, а браузерный доступ защищён паролем.
- Общие данные pi хранятся в `~/.pi/agent`, собственные данные Pi Web X — в `~/.pi-web-x`.

## Установка

macOS или Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

Windows PowerShell 5.1 и новее:

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```

Скрипт определяет ОС, архитектуру и libc в Linux, загружает подходящий GitHub Release и проверяет `SHA256SUMS`. Если политика безопасности требует этого, сначала скачайте и проверьте скрипт.

Для ручной установки скачайте файл с [GitHub Releases](https://github.com/xiaojueshi/pi-web-x/releases):

```bash
./pi-web-x
# Откройте http://127.0.0.1:30141
```

| Способ запуска | Нужен Bun | Нужен Node.js |
| --- | --- | --- |
| Исполняемый файл из GitHub Release | Нет | Нет |
| Разработка и сборка из исходников | Bun 1.4.0 | Нет |
| Необязательный npm launcher | Нет | Да, только для launcher |
| Установка plugin/skill и отдельные операции worktree | Нет | Вызываемой функции могут потребоваться `git` и `npm`/`npx` |

Скомпилированный файл содержит runtime Bun. Imports вроде `node:path` используют Node.js compatibility API в Bun и не означают, что сервер работает на Node.js. Подробности — в руководстве по [установке и обновлению](./docs/guides/installation.md).

## Первый запуск и безопасность

При первом запуске сервер один раз выводит setup token в stderr. Введите token в браузере и создайте пароль. Последующие запросы браузера используют HttpOnly session Cookie. Данные аутентификации находятся в `~/.pi-web-x/auth/` отдельно от данных pi в `~/.pi/agent`.

По умолчанию сервер слушает `127.0.0.1`. Параметр `-H 0.0.0.0` открывает по сети сервис с возможностью выполнять привилегированные операции над проектом. Используйте браузерную аутентификацию или длинный случайный `PI_WEB_X_PASSWORD`, а также HTTPS либо доверенный VPN. Перед сетевым развёртыванием прочитайте [SECURITY.md](./SECURITY.md).

## Запуск и настройка

```text
pi-web-x [-p <port>] [-H <hostname>] [--no-open]
pi-web-x service install|uninstall
pi-web-x update [--check]
pi-web-x assets status
pi-web-x assets install <archive>
```

Основные переменные окружения:

| Переменная | Назначение |
| --- | --- |
| `PORT` | Порт, по умолчанию `30141` |
| `PI_WEB_X_HOSTNAME` | Адрес прослушивания, по умолчанию `127.0.0.1` |
| `PI_WEB_X_NO_OPEN` | Не открывать браузер для `1/true/yes/on` |
| `PI_WEB_X_PASSWORD` | Резервный HTTP Basic Auth с именем пользователя `pi` |
| `PI_WEB_X_ALLOWED_HOSTS` | Дополнительные доверенные Host через запятую |
| `PI_WEB_X_SKIP_VERSION_CHECK` | Отключить проверку обновлений |

См. руководства по [настройке](./docs/guides/configuration.md), [браузерной аутентификации](./docs/guides/authentication.md), [системной службе](./docs/guides/system-service.md), [PWA](./docs/guides/pwa.md) и [Git worktree](./docs/guides/worktrees.md).

## Разработка

Для разработки, тестов и Release build используется **Bun 1.4.0**:

```bash
bun install --frozen-lockfile
bun run dev
bun test
bun run typecheck
bun run lint
bun run build
```

TypeScript явно загружает декларации `bun` и `node`: типы Bun описывают реальный runtime, а типы Node — совместимые модули `node:*` в Bun. Необязательный npm launcher — единственный путь проекта, который действительно выполняется в Node.js.

Перед изменениями прочитайте [CONTRIBUTING.md](./CONTRIBUTING.md), [обзор архитектуры](./docs/development/architecture.md), [границы Bun/Node](./docs/development/bun-and-node.md) и [руководство по тестам](./docs/development/testing.md).

## Документация и поддержка

[Указатель документации](./docs/README.md) разделяет руководства пользователя, материалы для разработки, architecture decisions, историю миграции и процедуры сопровождения.

- Вопросы и воспроизводимые ошибки: [GitHub Issues](https://github.com/xiaojueshi/pi-web-x/issues)
- Внесение изменений: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Уязвимости: [SECURITY.md](./SECURITY.md)
- История изменений: [CHANGELOG.md](./CHANGELOG.md)
- Правила сообщества: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## Лицензия и происхождение

[MIT](./LICENSE). Уведомления об авторских правах и лицензии исходного pi-web сохранены. История переноса находится в [`docs/history/bun-migration.md`](./docs/history/bun-migration.md), текущие решения по зависимостям и временные workaround — в [`docs/maintainers/`](./docs/maintainers/).
