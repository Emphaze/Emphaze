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
    page.get_by_role('button',name='Вход прайма',exact=True).click()
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
    # Manual edits set the actual value, including zero; they do not award income.
    earned_before = first_alliance()['earnedCaps']
    for target in [2000,1000,0,2480]:
        page.locator('.page-heading [data-action=adjust]').click()
        assert page.locator('[name=value]').input_value() == str(first_alliance()['caps'])
        page.locator('[name=value]').fill(str(target))
        submit()
        assert first_alliance()['caps'] == target
        assert first_alliance()['earnedCaps'] == earned_before
    # Selecting another alliance or an XP recipient refreshes the current value.
    page.locator('.page-heading [data-action=adjust]').click()
    page.locator('#adjust-alliance').select_option('alliance-2')
    assert page.locator('[name=value]').input_value() == '1920'
    page.locator('#adjust-alliance').select_option('alliance-1')
    assert page.locator('[name=value]').input_value() == '2480'
    page.locator('[name=resource]').select_option('xp')
    assert page.locator('[name=value]').input_value() == '1840'
    page.locator('[name=childId]').select_option('child-1-1')
    assert page.locator('[name=value]').input_value() == '220'
    page.locator('[name=value]').fill('420')
    page.locator('[name=reason]').fill('Разгадала космическую загадку')
    submit()
    assert first_alliance()['xp'] == 2040
    assert first_alliance()['children'][0]['xp'] == 420
    assert first_alliance()['caps'] == 2480
    page.reload()
    assert snapshot()['alliances'][0]['xp'] == 2040
    go('alliances')
    assert 'Уровень' not in page.locator('.alliance-banner').inner_text() or page.locator('.detail-stats').is_visible()
    # Imported notes are hidden even when the stored profile still contains them.
    notes_copy = page.request.get(URL+'/api/state').json()
    notes_copy['state']['alliances'][0]['sourceNotes'] = {'level':'Старая заметка из таблицы','cadia':'Старый бонус'}
    csrf = page.request.get(URL+'/api/session').json()['csrfToken']
    assert page.request.put(URL+'/api/state',data=notes_copy,headers={'Origin':URL,'X-CSRF-Token':csrf}).status == 200
    page.reload(); page.wait_for_selector('.access-banner.admin'); go('alliances')
    assert page.locator('.source-notes').count() == 0
    assert 'Старая заметка из таблицы' not in page.locator('main').inner_text()
    # Click a metric and edit it inside the alliance card; cancel does not save.
    def inline_value(resource,value):
        page.locator(f'.detail-stats [data-action=editMetric][data-resource={resource}]').click()
        assert page.locator('dialog[open]').count() == 0
        page.locator('.metric-form [name=value]').fill(str(value))
        page.locator('.metric-form .submit').click()
        page.locator('.metric-form').wait_for(state='detached')
    earned_inline = first_alliance()['earnedCaps']
    inline_value('caps',1000)
    assert first_alliance()['caps'] == 1000
    assert first_alliance()['earnedCaps'] == earned_inline
    inline_value('caps',2480)
    inline_value('xp',1900)
    assert first_alliance()['xp'] == 1900
    inline_value('xp',2040)
    inline_value('level',0)
    assert first_alliance()['xp'] == 2040
    assert page.locator('[data-action=editMetric][data-resource=level] .stat-value').inner_text() == '0'
    inline_value('level',5)
    assert first_alliance()['xp'] == 2040
    before_cancel = snapshot()
    page.locator('[data-action=editMetric][data-resource=caps]').click()
    page.locator('.metric-form [name=value]').fill('999')
    page.locator('.metric-form [name=value]').press('Escape')
    assert page.locator('.metric-form').count() == 0
    assert snapshot() == before_cancel
    # A refresh started before editing cannot replace an unsaved inline value.
    pending_refresh = []
    def hold_refresh(route):
        if route.request.method == 'GET': pending_refresh.append(route)
        else: route.continue_()
    page.route('**/api/state',hold_refresh)
    for _ in range(24):
        if pending_refresh: break
        page.wait_for_timeout(500)
    assert pending_refresh, 'Expected a periodic state refresh'
    page.locator('[data-action=editMetric][data-resource=caps]').click()
    page.locator('.metric-form [name=value]').fill('777')
    delayed_state = page.request.get(URL+'/api/state').json()
    delayed_state['revision'] += 1
    pending_refresh[0].fulfill(status=200,json=delayed_state)
    page.wait_for_timeout(100)
    assert page.locator('.metric-form [name=value]').input_value() == '777'
    page.unroute('**/api/state',hold_refresh)
    page.locator('[data-action=cancelMetric]').click()
    page.locator('[data-action=adjustRole][data-role=engineers]').click()
    assert page.locator('[name=value]').input_value() == '34'
    page.locator('[name=value]').fill('39')
    page.locator('[name=reason]').fill('Починили станцию')
    submit()
    assert first_alliance()['functions']['engineers'] == 39
    assert first_alliance()['functions']['raiders'] == 6
    # Results award every included alliance in a single operation.
    go('history')
    page.locator('[data-action=eventResults]').click()
    page.locator('[name=name]').fill('Космическая эстафета')
    before_rewards = snapshot()
    page.locator('[data-action=fillEventRewards]').click()
    assert page.locator('[name="caps-alliance-1"]').input_value() == '1800'
    assert page.locator('[name="xp-alliance-4"]').input_value() == '35'
    assert snapshot() == before_rewards  # Filling a form never grants resources.
    for i in range(1,5):
        page.locator(f'[name="caps-alliance-{i}"]').fill(str(400-i*50))
        page.locator(f'[name="xp-alliance-{i}"]').fill(str(100))
    submit()
    assert first_alliance()['caps'] == 2830
    assert first_alliance()['earnedCaps'] == 3630
    # New captures pay from the following landing, once per landing.
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
    assert record.locator('[data-action=claimBonus]').is_disabled()
    page.locator('[data-action=startLanding]').click()
    page.locator('[data-action=confirmLanding]').click()
    page.locator('dialog[open]').wait_for(state='detached')
    record.locator('[data-action=claimBonus]').click()
    record.locator('[data-action=claimBonus][disabled]').wait_for()
    assert record.locator('[data-action=claimBonus]').is_disabled()
    assert first_alliance()['caps'] == 2980
    assert first_alliance()['planets']['cadia']['actionPoints'] == 10
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
    # Only charge and mass are editable; legacy capacity does not limit charge.
    go('interface')
    assert page.locator('.interface-card').first.locator('.interface-values > div').count() == 2
    page.locator('[data-action=editInterface][data-id=alliance-1]').first.click()
    assert page.locator('dialog [name=maxCharge],dialog [name=resilience],dialog [name=gravitonsPurchased]').count() == 0
    page.locator('[name=charge]').fill('250')
    page.locator('[name=gravitons]').fill('9')
    submit()
    assert first_alliance()['interface']['charge'] == 250
    assert first_alliance()['interface']['gravitons'] == 9
    assert page.locator('.interface-card').first.locator('.interface-values > div').first.locator('strong').inner_text() == '250'
    # Upgrade purchase and craft use distinct operations.
    go('upgrades')
    assert page.locator('.item-card').count() == 27
    split_recipe = page.locator('.item-card').filter(has=page.get_by_role('heading',name='Лазерный расщепитель I',exact=True)).locator('.recipe-preview')
    split_recipe.locator('summary').click()
    assert split_recipe.locator('p').count() == 2
    assert split_recipe.locator('.recipe-or').inner_text() == 'или'
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
    assert first_alliance()['interface']['gravitonsPurchased'] == 1
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
    assert page.locator('.tool-level-group').evaluate_all('(groups) => groups.map(group => Number(group.dataset.toolLevel))') == list(range(1,14))
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
    assert page.locator('.tool-level-group').get_attribute('data-tool-level') == '9'
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
    page.get_by_role('button',name='Начать новое путешествие').click()
    page.get_by_role('button',name='Очистить данные и начать путешествие').click()
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
    page.get_by_role('button',name='Искатель',exact=True).click()
    page.locator('[name=name]').fill('Соня К.')
    page.locator('[name=role]').select_option('astrobiologists')
    submit()
    assert snapshot()['alliances'][-1]['children'][0]['role'] == 'astrobiologists'
    assert snapshot()['alliances'][-1]['caps'] == 0
    assert snapshot()['alliances'][-1]['interface']['charge'] == 200
    assert snapshot()['alliances'][-1]['interface']['gravitons'] == 1
    # Fresh alliance: a capture in landing 1 pays in landings 2 and 3.
    go('planets')
    page.locator('[data-action=planetTab][data-planet=cadia]').click()
    def start_landing():
        page.locator('[data-action=startLanding]').click()
        page.locator('[data-action=confirmLanding]').click()
        page.locator('dialog[open]').wait_for(state='detached')
    start_landing()
    page.locator('[data-action=addPlanet]').click()
    page.locator('[name=name]').fill('Пост «Повтор»')
    page.locator('[name=caps]').fill('10')
    submit()
    repeated = page.locator('.planet-record').filter(has=page.get_by_role('heading',name='Пост «Повтор»'))
    assert repeated.locator('[data-action=claimBonus]').is_disabled()
    for expected_caps in [10,20]:
        start_landing()
        repeated.locator('[data-action=claimBonus]').click()
        repeated.locator('[data-action=claimBonus][disabled]').wait_for()
        assert snapshot()['alliances'][-1]['caps'] == expected_caps
        assert snapshot()['alliances'][-1]['planets']['cadia']['actionPoints'] == 8
    # Inline editors fit narrow screens and cancel without changing progress.
    go('alliances')
    for width in [320,390]:
        page.set_viewport_size({'width':width,'height':900})
        page.locator('[data-action=editMetric][data-resource=caps]').click()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if width == 390: page.screenshot(path='/tmp/genesis-inline-owner.png',full_page=True)
        page.locator('[data-action=cancelMetric]').click()
    page.set_viewport_size({'width':1440,'height':1050})
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
        if target == 'alliances': assert mobile.locator('[data-action=editMetric],.metric-form').count() == 0
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'),target
    page.get_by_role('button',name='Выйти',exact=True).click()
    page.get_by_role('button',name='Вход прайма',exact=True).wait_for()
    assert page.locator('.page-heading [data-action=adjust]').count()==0
    assert page.request.get(URL+'/api/session').json()['role']=='viewer'
    assert not errors,errors
    print('PASS: currency/XP/roles, editable reward presets, all planets, recurring landing bonuses, interface defaults, purchases, consuming craft, tool levels, backups, owner/viewer permissions and all mobile pages. No JavaScript errors.')
    browser.close()
