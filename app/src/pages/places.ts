import { html } from '../core/html';
import { getAll } from '../core/api';
import { todayIso } from '../core/base';
import { t } from '../core/spanish';
import { head, todoTabs } from '../core/dom';
import { normGroup } from '../core/feed';
import { addDays } from '../core/helpers';
import { lists } from '../core/lists';
import { VIEWS } from '../core/router';
import { wantedStores } from '../features/stores';
import { suggestStores } from './map';

/* ================= To do > Places =================
   The Map page's "Stores found" suggestions (purchases like "WAL-MART #3826" with candidate stores, one tap to pin),
   for the last year, as a third To do tab. Same logic as the Map panel (pages/map.ts); nothing is written until you tap. */
VIEWS.places = async (r, paint) => {
  await lists();
  const groups = (await getAll('/transactions', { type: 'withdrawal', start: addDays(todayIso(), -365), end: todayIso() })).map(normGroup);
  const n = wantedStores(groups).reduce((a, w) => a + w.groups.length, 0);
  paint(html`${head('To do', n ? t(n === 1 ? '{count} purchase to pin to a store' : '{count} purchases to pin to a store', { count: n }) : 'Nothing to pin', '')}${todoTabs('places')}<section class="panel" id="storeList"></section>`);
  suggestStores(groups, true, false);
};
