import type { NuclearPlugin, NuclearPluginAPI } from '@nuclearplayer/plugin-sdk';

import { METADATA_PROVIDER_ID, STREAMING_PROVIDER_ID } from './config';
import { createMetadataProvider } from './metadata/metadata-provider';
import { MusicBrainzClient } from './sources/musicbrainz';
import { clearScClientIdCache } from './sources/soundcloud-stream';
import { createStreamingProvider } from './streaming/streaming-provider';

const plugin: NuclearPlugin = {
  onEnable(api: NuclearPluginAPI) {
    const mb = new MusicBrainzClient(api.Http.fetch);

    api.Providers.register(createStreamingProvider(api));
    api.Providers.register(createMetadataProvider(api, mb));
  },

  onDisable(api: NuclearPluginAPI) {
    api.Providers.unregister(STREAMING_PROVIDER_ID);
    api.Providers.unregister(METADATA_PROVIDER_ID);
    clearScClientIdCache();
  },
};

export default plugin;
