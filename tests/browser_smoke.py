"""Real browser checks in an isolated profile; requires Playwright and system Chromium."""
from playwright.sync_api import sync_playwright
import json, os, tempfile, subprocess, socket, secrets, time, atexit
from pathlib import Path
URL = os.environ.get('SMENA_TEST_URL')
PASSWORD = os.environ.get('SMENA_TEST_PASSWORD')
if not URL:
    temp_server = tempfile.TemporaryDirectory(prefix='orbita-browser-server-')
    sock = socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]; sock.close()
    PASSWORD=secrets.token_urlsafe(24)
    environment={**os.environ,'PORT':str(port),'HOST':'127.0.0.1','DATA_DIR':temp_server.name,'ADMIN_PASSWORD':PASSWORD}
    process=subprocess.Popen(['node','server/local.js'],cwd=Path(__file__).resolve().parent.parent,env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def cleanup():
        process.terminate(); process.wait(timeout=5); temp_server.cleanup()
    atexit.register(cleanup)
    URL=f'http://127.0.0.1:{port}'
    for _ in range(100):
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.1): break
        except OSError: time.sleep(.05)
    else: raise RuntimeError('Test server did not start')
if not PASSWORD: raise RuntimeError('SMENA_TEST_PASSWORD is required when testing an existing server')
KEY = 'smena-space-v2'
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='orbita-test-') as tmp:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':1050}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_selector('.alliance-card')
    page.get_by_role('button',name='Вход организатора',exact=True).click()
    page.locator('[name=password]').fill(PASSWORD)
    page.locator('form .submit').click()
    page.wait_for_selector('.access-banner.admin')
    page.screenshot(path='/tmp/orbita-desktop.png', full_page=True)
    assert page.locator('.alliance-card').count() == 4
    def snapshot():
        return page.request.get(URL+'/api/state').json()['state']
    def first_alliance():
        return snapshot()['alliances'][0]
    def go(target):
        page.locator(f'nav [data-page="{target}"]').click()
    def submit(success=True):
        page.locator('dialog form .submit').click()
        if success: page.locator('dialog form').wait_for(state='detached')
    def close():
        page.get_by_role('button', name='Закрыть', exact=True).click()
    def settings():
        page.locator('.shift-switcher').click()
    def item_action(action, item_id):
        page.locator(f'.item-card [data-action="{action}"][data-id="{item_id}"]').click()
    # Currency and XP are independent; personal XP also raises alliance XP.
    page.locator('.page-heading [data-action=adjust]').click()
    page.locator('[name=resource]').select_option('xp')
    page.locator('[name=childId]').select_option('child-1-1')
    page.locator('[name=amount]').fill('200')
    page.locator('[name=reason]').fill('Разгадала космическую загадку')
    submit()
    assert first_alliance()['xp'] == 2040
    assert first_alliance()['children'][0]['xp'] == 420
    assert first_alliance()['caps'] == 2480
    page.reload()
    assert snapshot()['alliances'][0]['xp'] == 2040
    go('alliances')
    assert 'Уровень' not in page.locator('.alliance-banner').inner_text() or page.locator('.detail-stats').is_visible()
    page.locator('[data-action=adjustRole][data-role=engineers]').click()
    page.locator('[name=amount]').fill('5')
    page.locator('[name=reason]').fill('Починили станцию')
    submit()
    assert first_alliance()['functions']['engineers'] == 39
    assert first_alliance()['functions']['raiders'] == 6
    # Results award every included alliance in a single operation.
    go('history')
    page.locator('[data-action=eventResults]').click()
    page.locator('[name=name]').fill('Космическая эстафета')
    for i in range(1,5):
        page.locator(f'[name="caps-alliance-{i}"]').fill(str(400-i*50))
        page.locator(f'[name="xp-alliance-{i}"]').fill(str(100))
    submit()
    assert first_alliance()['caps'] == 2830
    assert first_alliance()['earnedCaps'] == 3630
    # Independent planetary tracking and a one-time, multi-resource outpost reward.
    go('planets')
    page.locator('[data-action=addPlanet]').click()
    page.locator('[name=name]').fill('Аванпост «Альфа»')
    page.locator('[name=caps]').fill('150')
    page.locator('[name=xp]').fill('60')
    page.locator('[name=actionPoints]').fill('2')
    page.locator('[name=toolId]').select_option('tool-6')
    page.locator('[name=quantity]').fill('2')
    submit()
    record = page.locator('.planet-record').filter(has=page.get_by_role('heading', name='Аванпост «Альфа»'))
    record.locator('[data-action=claimBonus]').click()
    record.locator('[data-action=claimBonus][disabled]').wait_for()
    assert record.locator('[data-action=claimBonus]').is_disabled()
    assert first_alliance()['caps'] == 2980
    assert first_alliance()['planets']['cadia']['actionPoints'] == 6
    assert first_alliance()['inventory']['tool-6'] == 3
    page.locator('[data-action=planetTab][data-planet=fenris]').click()
    page.locator('[data-action=addPlanet]').click()
    page.locator('[name=name]').fill('Ледяной сектор 99')
    page.locator('[name=note]').fill('Обнаружены кристаллы')
    submit()
    assert len(first_alliance()['planets']['fenris']['territories']) == 5
    page.locator('[data-action=planetTab][data-planet=cronus]').click()
    page.locator('[data-action=addPlanet]').click()
    page.locator('[name=name]').fill('«Комета»')
    submit()
    assert len(first_alliance()['planets']['cronus']['shuttles']) == 2
    # Charge validation, larger capacity, and gravitational mass.
    go('interface')
    page.locator('[data-action=editInterface][data-id=alliance-1]').first.click()
    page.locator('[name=charge]').fill('150')
    submit(False)
    assert page.locator('.form-error').inner_text()
    page.locator('[name=maxCharge]').fill('200')
    page.locator('[name=gravitons]').fill('9')
    page.locator('[name=gravitonsPurchased]').fill('9')
    submit()
    assert first_alliance()['interface']['charge'] == 150
    assert first_alliance()['interface']['maxCharge'] == 200
    # Upgrade purchase and craft use distinct operations.
    go('upgrades')
    assert page.locator('.item-card').count() == 27
    item_action('item','upgrade-1')
    submit()
    assert first_alliance()['caps'] == 2680
    assert 'upgrade-1' in first_alliance()['upgrades']
    item_action('craft','upgrade-2')
    page.locator('[name=ingredient-0]').select_option('tool-1')
    page.locator('[name=ingredient-1]').select_option('tool-2')
    submit()
    assert 'upgrade-2' in first_alliance()['upgrades']
    assert first_alliance()['inventory']['tool-1'] == 1
    assert 'tool-2' not in first_alliance()['inventory']
    assert first_alliance()['caps'] == 2680
    item_action('item','upgrade-27')
    submit()
    assert first_alliance()['interface']['gravitons'] == 10
    assert first_alliance()['interface']['gravitonsPurchased'] == 10
    item_action('item','upgrade-27')
    submit(False)
    assert 'Максимум' in page.locator('.form-error').inner_text()
    close()
    # Unknown equipment prices can be configured, and the edited price is used.
    go('equipment')
    assert page.locator('.item-card').count() == 42
    item_action('editItem','equip-1')
    page.locator('[name=price]').fill('250')
    submit()
    item_action('item','equip-1')
    submit()
    assert first_alliance()['inventory']['equip-1'] == 2
    assert first_alliance()['caps'] == 2230
    # A recipe with line-separated ingredients requires explicit review.
    item_action('craft','equip-11')
    assert page.get_by_role('heading',name='Подтвердите состав рецепта').is_visible()
    page.get_by_role('button',name='Проверить и настроить рецепт').click()
    page.locator('[name=recipeConfirmed]').check()
    submit()
    item_action('item','equip-2')
    page.locator('[data-action=grant]').click()
    page.locator('[name=reason]').fill('Награда за событие')
    submit()
    item_action('craft','equip-11')
    submit()
    assert first_alliance()['inventory']['equip-11'] == 1
    assert 'equip-2' not in first_alliance()['inventory']
    # Tool levels, crafting chain and the unresolved Форпост are visible.
    page.locator('[data-action=equipmentTab][data-tab=tools]').click()
    assert page.locator('.item-card').count() == 30
    item_action('craft','tool-6')
    submit()
    assert first_alliance()['inventory']['tool-6'] == 4
    assert 'tool-1' not in first_alliance()['inventory']
    assert 'tool-5' not in first_alliance()['inventory']
    item_action('item','tool-20')
    close()
    item_action('craft','tool-20')
    assert 'Форпост' in page.locator('dialog').inner_text()
    close()
    # Search, configurable XP thresholds and daily access purchase.
    page.locator('#search').fill('Кеплер')
    assert page.locator('.item-card').count() == 1
    settings()
    page.locator('[name=levelThresholds]').fill('0, 1000, 2000, 3000')
    submit()
    go('access')
    item_action('item','access-1')
    submit()
    assert first_alliance()['caps'] == 1430
    assert first_alliance()['access'] == ['access-1']
    # A clean start requires confirmation; prices survive, and backups restore all state.
    settings()
    backup = os.path.join(tmp,'backup.json')
    with page.expect_download() as downloaded:
        page.get_by_role('button',name='Экспорт JSON',exact=True).click()
    downloaded.value.save_as(backup)
    exported = json.load(open(backup))
    assert exported['version'] == 2
    assert exported['alliances'][0]['inventory']['tool-6'] == 4
    page.get_by_role('button',name='Начать чистую космическую смену').click()
    page.get_by_role('button',name='Удалить данные и начать смену').click()
    page.locator('dialog[open]').wait_for(state='detached')
    assert snapshot()['alliances'] == []
    assert snapshot()['itemOverrides']['equip-1']['price'] == 250
    settings()
    page.locator('#import-file').set_input_files(backup)
    page.locator('#confirm-import').click()
    page.locator('dialog[open]').wait_for(state='detached')
    assert first_alliance()['caps'] == 1430
    assert len(snapshot()['alliances']) == 4
    go('alliances')
    page.get_by_role('button',name='Новый альянс',exact=True).click()
    page.locator('[name=name]').fill('Кассиопея')
    submit()
    page.get_by_role('button',name='Участник',exact=True).click()
    page.locator('[name=name]').fill('Соня К.')
    page.locator('[name=role]').select_option('astrobiologists')
    submit()
    assert snapshot()['alliances'][-1]['children'][0]['role'] == 'astrobiologists'
    assert snapshot()['alliances'][-1]['caps'] == 0
    # Mobile navigation and overflow are tested in a fresh, uncontaminated profile.
    mobile = browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
    mobile.on('pageerror',lambda error:errors.append(str(error)))
    mobile.goto(URL)
    mobile.wait_for_selector('.access-banner.viewer')
    assert mobile.locator('[data-action=adjust]').count()==0
    assert mobile.request.put(URL+'/api/state',data={'revision':0,'state':snapshot()},headers={'Origin':URL}).status==401
    assert mobile.request.get(URL+'/api/state').json()['state']['alliances'][0]['caps']==1430
    mobile.screenshot(path='/tmp/orbita-mobile.png',full_page=True)
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert mobile.locator('.sidebar').bounding_box()['x'] + 230 <= 0
    for target in ['alliances','planets','interface','access','upgrades','equipment','history']:
        mobile.get_by_role('button',name='Открыть меню').click()
        mobile.locator(f'nav [data-page="{target}"]').click()
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'),target
    page.get_by_role('button',name='Выйти',exact=True).click()
    page.get_by_role('button',name='Вход организатора',exact=True).wait_for()
    assert page.locator('.page-heading [data-action=adjust]').count()==0
    assert page.request.get(URL+'/api/session').json()['role']=='viewer'
    assert not errors,errors
    print('PASS: currency/XP/roles, event awards, all three planets, one-time bonuses, interface limits, purchases, edited prices, consuming craft, recipe review, tool levels, search, XP thresholds, backups, reset, new alliances/children and all mobile pages. No JavaScript errors.')
    browser.close()
