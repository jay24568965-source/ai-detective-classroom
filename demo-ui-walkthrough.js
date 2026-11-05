const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    slowMo: 500,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({ viewport: null });
  const teacher = await context.newPage();
  await teacher.goto('http://127.0.0.1:3080/teacher.html', { waitUntil: 'networkidle' });
  await sleep(1200);

  await teacher.locator('#teacherName').fill('录屏教师');
  await teacher.locator('#caseSelect').selectOption('physics');
  await teacher.locator('#btnCreate').click();
  await teacher.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
  await sleep(1500);
  const code = (await teacher.locator('#roomCode').innerText()).trim();
  console.log('ROOM_CODE=' + code);

  await teacher.locator('button[data-stage="2"]').click();
  await sleep(800);
  await teacher.locator('button[data-stage="3"]').click();
  await sleep(1200);

  const student = await context.newPage();
  await student.goto('http://127.0.0.1:3080/student.html', { waitUntil: 'networkidle' });
  await sleep(1000);
  await student.locator('#code').fill(code);
  await student.locator('#groupId').fill('REC1');
  await student.locator('#groupLabel').fill('录屏演示组');
  await student.locator('#btnJoin').click();
  await sleep(1500);

  // dismiss brief if shown
  const brief = student.locator('#modalBrief');
  if (await brief.evaluate((el) => getComputedStyle(el).display !== 'none').catch(() => false)) {
    await student.locator('#btnBriefOk').click();
    await sleep(1000);
  } else {
    // overlays may use class
    const ok = student.locator('#btnBriefOk');
    if (await ok.isVisible().catch(() => false)) {
      await ok.click();
      await sleep(1000);
    }
  }
  // force show game if brief uses .active
  await student.evaluate(() => {
    const b = document.getElementById('modalBrief');
    const ok = document.getElementById('btnBriefOk');
    if (b && (b.classList.contains('show') || b.classList.contains('open') || getComputedStyle(b).opacity !== '0')) {
      ok && ok.click();
    }
  });
  await sleep(800);
  if (await student.locator('#btnBriefOk').isVisible().catch(() => false)) {
    await student.locator('#btnBriefOk').click({ force: true });
    await sleep(800);
  }

  await student.locator('#gameUI').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const canvas = student.locator('#gameCanvas');
  await canvas.click({ position: { x: 240, y: 260 } });
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp', 'e', 'ArrowRight', 'e', 'ArrowDown', 'e']) {
    await student.keyboard.press(k);
    await sleep(500);
  }
  // close item modal if open
  if (await student.locator('#btnCloseItem').isVisible().catch(() => false)) {
    await student.locator('#btnCloseItem').click();
    await sleep(600);
  }

  await student.locator('#btnNotes').click();
  await sleep(600);
  await student.locator('#notesArea').fill('A制动前约20m/s=72km/h，与其“未超50”陈述矛盾。');
  await student.locator('#btnSaveNotes').click();
  await sleep(800);
  if (await student.locator('#btnCloseNotes').isVisible().catch(() => false)) {
    await student.locator('#btnCloseNotes').click();
  }

  await teacher.bringToFront();
  await sleep(1000);
  await teacher.locator('#btnOpenVote').click();
  await sleep(1500);

  await student.bringToFront();
  await sleep(1000);
  // Try host path: open vote modal via API-less UI — click host vote if available by pressing E near host after map switch
  // Fallback: inject open vote modal for demo visibility if host hard to reach
  const opened = await student.evaluate(() => {
    const btn = document.getElementById('btnHostVote');
    const modal = document.getElementById('modalVote');
    if (btn) {
      btn.style.display = 'inline-block';
      btn.click();
      return 'host';
    }
    if (modal) {
      modal.classList.add('show');
      modal.style.display = 'flex';
      return 'force';
    }
    return 'none';
  });
  console.log('VOTE_UI=' + opened);
  await sleep(1000);

  if (await student.locator('#voteSuspect').isVisible().catch(() => false)) {
    await student.locator('#voteSuspect').selectOption('A');
    await student.locator('#voteEvidence').fill('E04,E07,E08,E13');
    await student.locator('#voteRationale').fill('A声称制动前未超50km/h，物理重建约为72km/h，陈述与模型矛盾。');
    await sleep(1200);
    await student.locator('#btnSubmitVote').click();
    await sleep(2000);
  }

  await teacher.bringToFront();
  await sleep(1000);
  await teacher.locator('#btnCloseVote').click();
  await sleep(1000);
  await teacher.locator('#btnReveal').click();
  await sleep(2500);

  await student.bringToFront();
  await sleep(3000);
  if (await student.locator('#btnCloseResult').isVisible().catch(() => false)) {
    await sleep(4000);
  }
  console.log('DEMO_UI_DONE');
  await sleep(25000);
  await browser.close();
})().catch((e) => {
  console.error('DEMO_UI_FAIL', e);
  process.exit(1);
});
