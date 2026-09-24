// Local UI fixtures only. Every backend request is intercepted; no care data is written.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok'}).format(new Date());
    const profile = {id:'u1', full_name:'Jamie Park', role:'admin', organization_id:'o1'};
    const patients = [
      {id:'p1', name:'Alex Morgan', age:74}, {id:'p2', name:'Robin Lee', age:68}, {id:'p3', name:'Sam Taylor', age:81},
    ].map(p => ({...p, status:'ACTIVE', profile_photo:null, date_of_birth:null, emergency_contact:{}}));
    const eventBase = {scheduled_date:date, scheduled_at:`${date}T08:00:00+07:00`, due_at:`${date}T09:00:00+07:00`, timezone:'Asia/Bangkok', recurrence:'ONCE', payload:{}, response_data:{}, patient_id:'p1'};
    const events = [
      {id:'e1', event_type:'DAILY_CHECK_IN', title:'How are you feeling today?', scheduled_time:'08:00:00', status:'MISSED'},
      {id:'e2', event_type:'MEAL', title:'Breakfast', scheduled_time:'08:30:00', status:'COMPLETED', response_data:{response:'YES'}},
      {id:'e3', event_type:'TASK', title:'Seated stretching', scheduled_time:'10:00:00', status:'SCHEDULED', patient_id:'p2'},
      {id:'e4', event_type:'DAILY_CHECK_IN', title:'Afternoon check-in', scheduled_time:'14:00:00', status:'SCHEDULED', patient_id:'p3'},
    ].map(e => ({...eventBase,...e}));
    let reviewed = false;
    let failEvents = false;
    let sparse = false;
    await page.addInitScript(() => localStorage.setItem('sb-localhost-auth-token', JSON.stringify({access_token:'fixture-token', refresh_token:'fixture-refresh', expires_at:4102444800, user:{id:'u1'}})));
    await page.route('http://localhost/**', async route => {
      const url = new URL(route.request().url());
      const table = url.pathname.split('/').pop();
      if (table === 'review_alert') { reviewed = true; return route.fulfill({status:200, contentType:'application/json', body:'null'}); }
      if (table === 'care_events' && failEvents) return route.fulfill({status:500, contentType:'application/json', body:JSON.stringify({message:'Test: schedule unavailable'})});
      let rows = {
        profiles:[profile], organizations:[{id:'o1', name:'P-kun Care Team', timezone:'Asia/Bangkok'}],
        patients:sparse ? patients.slice(0,1) : patients,
        devices:[{id:'d1', device_name:'P-kun / Alex', assigned_patient_id:'p1', status:'OFFLINE', last_seen:new Date(Date.now()-3600000).toISOString()}],
        care_events:sparse ? events.slice(0,1) : events,
        messages:[],
        alerts:reviewed ? [] : [{id:'a1', patient_id:'p1', event_id:'e1', alert_type:'MISSED_EVENT', priority:'ATTENTION', reviewed:false, message:'No response to the morning check-in.', created_at:new Date().toISOString()}],
      }[table] ?? [];
      for (const [key, value] of url.searchParams.entries()) {
        if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
        if (key === 'scheduled_date' && value.startsWith('gte.')) rows = rows.filter(row => row.scheduled_date >= value.slice(4));
        if (key === 'scheduled_date' && value.startsWith('lte.')) rows = rows.filter(row => row.scheduled_date <= value.slice(4));
      }
      const single = route.request().headers().accept?.includes('vnd.pgrst.object');
      await route.fulfill({status:200, contentType:'application/json', headers:{'content-range':`0-${Math.max(0,rows.length-1)}/${rows.length}`}, body:JSON.stringify(single ? rows[0] ?? null : rows)});
    });
    const output = path.join(process.env.TEMP || '.', 'pkun-ui-check');
    fs.mkdirSync(output, {recursive:true});
    const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5187';
    for (const width of [1440, 768, 390, 320]) {
      reviewed = false;
      await page.setViewportSize({width,height:1000});
      await page.goto(base);
      await page.getByRole('heading', {name:'My day', exact:true}).waitFor();
      await page.locator('.agenda-event').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.getByRole('searchbox').fill('zzzz');
      await expect(page.getByText('No patients match this name.')).toBeVisible();
      await page.getByRole('searchbox').fill('');
      await page.getByRole('button', {name:'Missed 1', exact:true}).click();
      await expect(page.locator('.agenda-event')).toHaveCount(1);
      await page.getByRole('button', {name:'All activity 4', exact:true}).click();
      await expect(page.locator('.agenda-event')).toHaveCount(4);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      await page.screenshot({path:path.join(output,`day-workspace-${width}.png`),fullPage:true});
      await page.locator('.patient-roster').getByRole('button', {name:/Robin Lee/}).click();
      await expect(page.getByRole('heading', {name:'Robin Lee', exact:true})).toBeVisible();
      await expect(page.locator('.agenda-event')).toHaveCount(1);
      await expect(page.getByText('No alerts awaiting review')).toBeVisible();
      await page.getByRole('button', {name:'Schedule care', exact:true}).first().click();
      await expect(page.getByRole('dialog').locator('select').first()).toHaveValue('p2');
      await page.keyboard.press('Escape');
      await page.getByRole('button', {name:/All patients/}).click();
      await page.getByRole('button', {name:'Next day', exact:true}).click();
      await expect(page.getByText('A clear schedule')).toBeVisible();
      await page.getByRole('button', {name:'Today', exact:true}).click();
      await expect(page.locator('.agenda-event')).toHaveCount(4);
      await page.locator('.agenda-event').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('heading', {level:2})).toContainText('How are you feeling');
      await page.keyboard.press('Escape');
      await page.getByRole('button', {name:'Mark reviewed', exact:true}).click();
      await expect(page.getByText('No alerts awaiting review')).toBeVisible();
      if (width <= 640) await page.getByRole('button', {name:'Open menu'}).click();
      await page.getByRole('navigation').getByRole('link', {name:'Patients',exact:true}).click();
      await expect(page.getByRole('heading', {name:'Patients',exact:true})).toBeVisible();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Patients overflow at ${width}`);
      if (width === 1440) await page.screenshot({path:path.join(output,'patients-desktop.png'),fullPage:true});
      if (width <= 640) await expect(page.getByRole('button', {name:'Open menu'})).toBeVisible();
    }
    await page.setViewportSize({width:1440,height:1000});
    sparse = true; reviewed = false;
    await page.goto(base);
    await expect(page.locator('.agenda-event')).toHaveCount(1);
    await page.screenshot({path:path.join(output,'day-workspace-single-patient.png'),fullPage:true});
    for (const [route, title] of [['calendar','Calendar'], ['alerts','Alerts'], ['devices','P-kun devices'], ['history','History'], ['check-ins','Daily check-in'], ['settings','Team & settings'], ['patients/p1','Alex Morgan']]) {
      await page.goto(`${base}/${route}`);
      await expect(page.getByRole('heading', {level:1})).toContainText(title);
      await expect(page.locator('.spinner-wrap')).toHaveCount(0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow on ${route}`);
      await page.screenshot({path:path.join(output,`${route.replaceAll('/','-')}-desktop.png`),fullPage:true});
    }
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:1000});
      for (const route of ['calendar','alerts','devices','history','check-ins','settings','patients/p1']) {
        await page.goto(`${base}/${route}`);
        await expect(page.getByRole('heading', {level:1})).toBeVisible();
        await expect(page.locator('.spinner-wrap')).toHaveCount(0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflow at ${width}`);
      }
    }
    failEvents = true;
    await page.goto(base);
    await expect(page.getByText('Schedule unavailable', {exact:true})).toBeVisible();
    failEvents = false;
    await page.getByRole('button', {name:'Try again',exact:true}).click();
    await expect(page.locator('.agenda-event')).toHaveCount(1);
    assert.deepEqual(errors, []);
    console.log('Passed: 4 viewports, patient search/selection, activity filters, date navigation, prefilled scheduling, event details, review refresh, patient navigation, sparse data, error/retry, no page overflow or JS exceptions. Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exitCode = 1;});
