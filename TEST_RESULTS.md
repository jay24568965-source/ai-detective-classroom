# TEST_RESULTS

Generated: 2026-11-05T04:31:16.170Z (script clock; report to user in Asia/Shanghai).

Automated: 55/55 passed.

| ID | Result | Name | Detail |
|----|--------|------|--------|
| 0 | PASS | health |  |
| physics-1a | PASS | create room physics | FCBCB0 |
| physics-1b | PASS | student join |  |
| physics-9a | PASS | student case omits correctSuspectId |  |
| physics-title | PASS | case title loaded | 意外的急刹车 |
| physics-7a | PASS | cannot vote before open | 403 |
| physics-3a | PASS | investigate item | 限速标志记录 |
| physics-13a | PASS | mock presets available | 演示问答（Mock） |
| physics-13b | PASS | mock ask works |  |
| physics-7b | PASS | teacher open vote |  |
| physics-8a | PASS | first vote accepted | 已提交，等待揭晓 |
| physics-8b | PASS | no second vote / no change | 409 |
| physics-9b | PASS | pre-reveal no result grade | {"status":"已提交，等待揭晓"} |
| physics-9c | PASS | pre-reveal no correct id in state |  |
| physics-7c | PASS | cannot vote after close | 403 |
| physics-10a | PASS | reveal ok | A |
| physics-10b | PASS | correct → 合格 | 合格 |
| physics-10c | PASS | 未提交 separate | 未提交 |
| physics-10d | PASS | wrong → 不合格 | 不合格 |
| physics-11 | PASS | no second round after reveal | 400 |
| physics-12a | PASS | refresh restore via token |  |
| physics-14a | PASS | export JSON |  |
| physics-14b | PASS | export CSV utf8 |  |
| physics-12b | PASS | teacher auth required |  |
| physics-stage | PASS | E07 locked until stage 2 | early=false late=true |
| physics-isol | PASS | case id matches selection | physics |
| chemistry-1a | PASS | create room chemistry | 3AE1DF |
| chemistry-1b | PASS | student join |  |
| chemistry-9a | PASS | student case omits correctSuspectId |  |
| chemistry-title | PASS | case title loaded | 台风夜老宅 |
| chemistry-7a | PASS | cannot vote before open | 403 |
| chemistry-3a | PASS | investigate item | 时间线告示板 |
| chemistry-13a | PASS | mock presets available | 演示问答（Mock） |
| chemistry-13b | PASS | mock ask works |  |
| chemistry-7b | PASS | teacher open vote |  |
| chemistry-8a | PASS | first vote accepted | 已提交，等待揭晓 |
| chemistry-8b | PASS | no second vote / no change | 409 |
| chemistry-9b | PASS | pre-reveal no result grade | {"status":"已提交，等待揭晓"} |
| chemistry-9c | PASS | pre-reveal no correct id in state |  |
| chemistry-7c | PASS | cannot vote after close | 403 |
| chemistry-10a | PASS | reveal ok | zhou |
| chemistry-10b | PASS | correct → 合格 | 合格 |
| chemistry-10c | PASS | 未提交 separate | 未提交 |
| chemistry-10d | PASS | wrong → 不合格 | 不合格 |
| chemistry-11 | PASS | no second round after reveal | 400 |
| chemistry-12a | PASS | refresh restore via token |  |
| chemistry-14a | PASS | export JSON |  |
| chemistry-14b | PASS | export CSV utf8 |  |
| chemistry-12b | PASS | teacher auth required |  |
| chemistry-isol | PASS | case id matches selection | chemistry |
| 12c | PASS | group evidence isolation |  |
| static-/ | PASS | serves / | 200 |
| static-/teacher.html | PASS | serves /teacher.html | 200 |
| static-/student.html | PASS | serves /student.html | 200 |
| static-/js/game-engine.js | PASS | serves /js/game-engine.js | 200 |

## Manual checks (not claimed automated)

- [ ] WASD movement, collision with walls, door transitions (physics road↔hq, chemistry rooms)
- [ ] Panel open blocks movement keys; close restores
- [ ] Touch pad on coarse pointer
- [ ] UI label 演示问答（Mock） visible during interview
- [ ] After submit, UI shows only 已提交，等待揭晓 until teacher reveal
- [ ] No UI for second round / eliminate / bonus clues
- [ ] Chemistry TODO markers visible on C-E05 card

## Automated suite green.
