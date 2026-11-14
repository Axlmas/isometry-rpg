# Isometry RPG

Изометрическая RPG, которую мы делаем вайбкодингом вместе с Claude.

**Играть:** https://axlmas.github.io/isometry-rpg/

## Структура

| Путь | Что там |
|---|---|
| `CLAUDE.md` | Правила работы для Claude: стек, порядок работы, деплой |
| `docs/GDD.md` | Дизайн игры: идея, механики, roadmap |
| `.github/workflows/deploy.yml` | Автодеплой на GitHub Pages после каждого push в `main` |

## Как работаем

1. Ставлю задачу Claude (в Claude Code, репозиторий `isometry-rpg`).
2. Claude делает её в отдельной ветке и открывает pull request.
3. Проверяю PR и сливаю в `main`. Через 1–2 минуты новая версия появляется по ссылке выше.
