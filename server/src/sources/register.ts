// Real data sources are registered here. Enable/disable them in server/data/config.json.
import { registerAdapter } from '../refresh.ts';
import { dutchieAdapter } from './dutchie.ts';
import { eazeAdapter } from './eaze.ts';
import { janeAdapter } from './jane.ts';
import { weedmapsAdapter } from './weedmaps.ts';

registerAdapter(dutchieAdapter);
registerAdapter(janeAdapter);
registerAdapter(weedmapsAdapter);
registerAdapter(eazeAdapter);
