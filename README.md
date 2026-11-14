# Isometry RPG

Изометрическая RPG, которую мы делаем вайбкодингом вместе с Claude.

**Играть:** https://axlmas.github.io/isometry-rpg/

**Превью веток в работе:** https://axlmas.github.io/isometry-rpg/preview/

## Структура

| Путь | Что там |
|---|---|
| `CLAUDE.md` | Правила работы для Claude: стек, порядок работы, деплой |
| `docs/GDD.md` | Дизайн игры: идея, механики, roadmap |
| `.github/workflows/deploy.yml` | Автодеплой на GitHub Pages: `main` и превью всех веток |

## Как работаем

1. Ставлю задачу Claude (в Claude Code, репозиторий `isometry-rpg`). Одна задача — одна сессия.
2. Claude делает её в отдельной ветке и открывает pull request со ссылкой на превью.
3. Играю в превью. Нравится — сливаю PR, и через 1–2 минуты изменения попадают в основную версию.
