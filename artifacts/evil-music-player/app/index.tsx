import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type Track = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  duration: number;
  filename: string;
};

type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
};

type Page = 'library' | 'playlists' | 'nowPlaying';
type LibraryState = 'idle' | 'scanning' | 'ready' | 'permission' | 'blocked' | 'error';

const PLAYLISTS_KEY = '@evil-music-player/playlists-v1';

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function trackFromFilename(
  id: string,
  uri: string,
  filename: string,
  durationMs: number | null,
): Track {
  const withoutExtension = filename.replace(/\.[^.]+$/, '');
  const separator = withoutExtension.indexOf(' - ');
  const artist = separator > 0 ? withoutExtension.slice(0, separator) : 'Unknown artist';
  const title = separator > 0 ? withoutExtension.slice(separator + 3) : withoutExtension;
  return {
    id,
    uri,
    title: title || filename,
    artist,
    duration: durationMs ? durationMs / 1000 : 0,
    filename,
  };
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const player = useAudioPlayer(null, { updateInterval: 400 });
  const playback = useAudioPlayerStatus(player);
  const [page, setPage] = useState<Page>('library');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [libraryState, setLibraryState] = useState<LibraryState>('idle');
  const [libraryMessage, setLibraryMessage] = useState('');
  const [otherAudioCount, setOtherAudioCount] = useState(0);
  const [scanError, setScanError] = useState('');
  const [audioError, setAudioError] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [trackToAdd, setTrackToAdd] = useState<Track | null>(null);
  const [repeatAll, setRepeatAll] = useState(false);
  const [progressWidth, setProgressWidth] = useState(1);
  const [notice, setNotice] = useState('');
  const finishHandled = useRef(false);

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId],
  );

  const visiblePlaylistTracks = useMemo(() => {
    if (!selectedPlaylist) return [];
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    return selectedPlaylist.trackIds
      .map((trackId) => tracksById.get(trackId))
      .filter((track): track is Track => Boolean(track));
  }, [selectedPlaylist, tracks]);

  const currentQueueIndex = currentTrack
    ? queue.findIndex((track) => track.id === currentTrack.id)
    : -1;
  const duration = playback.duration || currentTrack?.duration || 0;
  const progress = duration > 0 ? Math.min(playback.currentTime / duration, 1) : 0;

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PLAYLISTS_KEY)
      .then((value) => {
        if (!active) return;
        if (value) {
          const parsed = JSON.parse(value) as Playlist[];
          if (Array.isArray(parsed)) setPlaylists(parsed);
        }
      })
      .catch(() => {
        if (active) setNotice('Playlists could not be loaded from this device.');
      })
      .finally(() => {
        if (active) setPlaylistsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!playlistsLoaded) return;
    AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists)).catch(() => {
      setNotice('Playlists could not be saved. Check your device storage and try again.');
    });
  }, [playlists, playlistsLoaded]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {
      setAudioError('Audio could not be initialized. Close and reopen the app to try again.');
    });

    return () => {
      player.clearLockScreenControls();
    };
  }, [player]);

  const tapFeedback = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync().catch(() => undefined);
    }
  }, []);

  const scanLibrary = useCallback(async () => {
    if (Platform.OS === 'web') {
      setLibraryMessage('Open this app on an Android phone to scan music stored on the device.');
      setLibraryState('idle');
      return;
    }

    setLibraryState('scanning');
    setScanError('');
    setLibraryMessage('');
    try {
      const MediaLibrary = await import('expo-media-library');
      let permission = await MediaLibrary.getPermissionsAsync(false, ['audio']);
      if (!permission.granted) {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      }
      if (!permission.granted) {
        setLibraryState(permission.canAskAgain ? 'permission' : 'blocked');
        return;
      }

      const assets = await new MediaLibrary.Query()
        .eq(MediaLibrary.AssetField.MEDIA_TYPE, MediaLibrary.MediaType.AUDIO)
        .exe();
      const audioFiles = await Promise.all(
        assets.map(async (asset) => {
          const filename = await asset.getFilename();
          if (!filename.toLowerCase().endsWith('.mp3')) return null;
          const [uri, durationMs] = await Promise.all([
            asset.getUri(),
            asset.getDuration().catch(() => null),
          ]);
          return trackFromFilename(asset.id, uri, filename, durationMs);
        }),
      );
      const foundTracks = audioFiles
        .filter((track): track is Track => track !== null)
        .sort((a, b) => a.title.localeCompare(b.title));
      setTracks(foundTracks);
      setOtherAudioCount(assets.length - foundTracks.length);
      setLibraryState('ready');
      if (foundTracks.length === 0) {
        setLibraryMessage(
          assets.length > 0
            ? `No MP3 files found among ${assets.length} audio files. Copy MP3s into Music or Downloads, then scan again.`
            : 'No audio files found yet. Add MP3s to Music or Downloads, then scan again.',
        );
      } else {
        setLibraryMessage('');
        setNotice(`Found ${foundTracks.length} MP3${foundTracks.length === 1 ? '' : 's'} on your phone.`);
      }
    } catch (error) {
      setLibraryState('error');
      setScanError(
        error instanceof Error
          ? error.message
          : 'Your music library could not be read. Check access and try again.',
      );
    }
  }, []);

  const setLockScreenTrack = useCallback(
    (track: Track) => {
      player.setActiveForLockScreen(
        true,
        {
          title: track.title,
          artist: track.artist,
          albumTitle: 'Evil Spotify · Offline',
        },
        { showSeekBackward: true, showSeekForward: true },
      );
    },
    [player],
  );

  const startTrack = useCallback(
    (track: Track, nextQueue: Track[]) => {
      tapFeedback();
      const safeQueue = nextQueue.length > 0 ? nextQueue : [track];
      setQueue(safeQueue);
      setCurrentTrack(track);
      setAudioError('');
      player.replace({ uri: track.uri, name: track.title });
      setLockScreenTrack(track);
      player.play();
    },
    [player, setLockScreenTrack, tapFeedback],
  );

  const playNext = useCallback(() => {
    if (queue.length === 0) return;
    const nextIndex =
      currentQueueIndex < 0 || currentQueueIndex + 1 >= queue.length
        ? repeatAll
          ? 0
          : -1
        : currentQueueIndex + 1;
    if (nextIndex >= 0) {
      startTrack(queue[nextIndex], queue);
    } else {
      player.pause();
      player.seekTo(0).catch(() => undefined);
    }
  }, [currentQueueIndex, player, queue, repeatAll, startTrack]);

  const playPrevious = useCallback(() => {
    if (!currentTrack) return;
    if (playback.currentTime > 3) {
      player.seekTo(0).catch(() => undefined);
      return;
    }
    const previousIndex =
      currentQueueIndex > 0
        ? currentQueueIndex - 1
        : repeatAll && queue.length > 1
          ? queue.length - 1
          : 0;
    const previousTrack = queue[previousIndex];
    if (previousTrack) startTrack(previousTrack, queue);
  }, [currentQueueIndex, currentTrack, playback.currentTime, player, queue, repeatAll, startTrack]);

  useEffect(() => {
    if (!playback.didJustFinish) {
      finishHandled.current = false;
      return;
    }
    if (!finishHandled.current && currentTrack) {
      finishHandled.current = true;
      playNext();
    }
  }, [currentTrack, playback.didJustFinish, playNext]);

  const togglePlayback = useCallback(() => {
    if (!currentTrack) return;
    tapFeedback();
    if (playback.playing) {
      player.pause();
    } else {
      setLockScreenTrack(currentTrack);
      player.play();
    }
  }, [currentTrack, playback.playing, player, setLockScreenTrack, tapFeedback]);

  const createPlaylist = useCallback(() => {
    const name = playlistName.trim();
    if (!name) return;
    if (playlists.some((playlist) => playlist.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Playlist already exists', 'Choose a different name for this playlist.');
      return;
    }
    const playlist: Playlist = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      trackIds: trackToAdd ? [trackToAdd.id] : [],
    };
    setPlaylists((existing) => [playlist, ...existing]);
    setPlaylistName('');
    setCreateModalVisible(false);
    setPlaylistModalVisible(false);
    setNotice(trackToAdd ? `Created “${name}” and added the song.` : `Created “${name}”.`);
    setTrackToAdd(null);
    tapFeedback();
  }, [playlists, playlistName, tapFeedback, trackToAdd]);

  const addTrackToPlaylist = useCallback(
    (playlistId: string) => {
      if (!trackToAdd) return;
      const target = playlists.find((playlist) => playlist.id === playlistId);
      if (target?.trackIds.includes(trackToAdd.id)) {
        setNotice(`“${trackToAdd.title}” is already in ${target.name}.`);
      } else {
        setPlaylists((existing) =>
          existing.map((playlist) =>
            playlist.id === playlistId
              ? { ...playlist, trackIds: [...playlist.trackIds, trackToAdd.id] }
              : playlist,
          ),
        );
        setNotice(`Added “${trackToAdd.title}” to ${target?.name ?? 'playlist'}.`);
      }
      setPlaylistModalVisible(false);
      setTrackToAdd(null);
      tapFeedback();
    },
    [playlists, tapFeedback, trackToAdd],
  );

  const removePlaylist = useCallback((playlist: Playlist) => {
    Alert.alert('Delete playlist?', `“${playlist.name}” will be removed. Your MP3 files stay on your phone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setPlaylists((existing) => existing.filter((item) => item.id !== playlist.id));
          if (selectedPlaylistId === playlist.id) setSelectedPlaylistId(null);
          setNotice(`Deleted “${playlist.name}”.`);
        },
      },
    ]);
  }, [selectedPlaylistId]);

  const removeTrackFromPlaylist = useCallback(
    (track: Track) => {
      if (!selectedPlaylist) return;
      setPlaylists((existing) =>
        existing.map((playlist) =>
          playlist.id === selectedPlaylist.id
            ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== track.id) }
            : playlist,
        ),
      );
      setNotice(`Removed “${track.title}” from ${selectedPlaylist.name}.`);
    },
    [selectedPlaylist],
  );

  const seekFromTouch = useCallback(
    (locationX: number) => {
      if (duration <= 0 || progressWidth <= 0) return;
      const position = Math.max(0, Math.min(locationX / progressWidth, 1)) * duration;
      player.seekTo(position).catch(() => undefined);
    },
    [duration, player, progressWidth],
  );

  const closePlaylistDetail = useCallback(() => {
    setSelectedPlaylistId(null);
  }, []);

  const goToPage = useCallback((nextPage: Page) => {
    setPage(nextPage);
    if (nextPage !== 'playlists') setSelectedPlaylistId(null);
  }, []);

  const selectedPlaylistMissingCount = selectedPlaylist
    ? selectedPlaylist.trackIds.length - visiblePlaylistTracks.length
    : 0;

  const renderTrack = (track: Track, sourceQueue: Track[], showRemove = false) => (
    <View key={`${track.id}-${showRemove ? 'playlist' : 'library'}`} style={styles.trackRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${track.title} by ${track.artist}`}
        onPress={() => startTrack(track, sourceQueue)}
        style={({ pressed }) => [styles.trackMain, pressed && styles.pressed]}
      >
        <View style={[styles.trackArtwork, { backgroundColor: colors.accent }]}>
          <Ionicons name="musical-note" size={18} color={colors.primary} />
        </View>
        <View style={styles.trackInfo}>
          <Text numberOfLines={1} style={[styles.trackTitle, { color: colors.foreground }]}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={[styles.trackArtist, { color: colors.mutedForeground }]}>
            {track.artist}
          </Text>
        </View>
        {track.duration > 0 ? (
          <Text style={[styles.trackDuration, { color: colors.mutedForeground }]}>
            {formatTime(track.duration)}
          </Text>
        ) : null}
      </Pressable>
      {showRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from playlist`}
          onPress={() => removeTrackFromPlaylist(track)}
          hitSlop={10}
          style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
        >
          <Ionicons name="remove-circle-outline" size={21} color={colors.mutedForeground} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${track.title} to a playlist`}
          onPress={() => {
            setTrackToAdd(track);
            setPlaylistModalVisible(true);
          }}
          hitSlop={10}
          style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
  );

  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;
  const screenTitle =
    page === 'library' ? 'Your library' : page === 'playlists' ? 'Your playlists' : 'Now playing';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topInset }]}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <View style={styles.brandLockup}>
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
            <Ionicons name="play" size={14} color={colors.primaryForeground} />
          </View>
          <View>
            <Text style={[styles.brandName, { color: colors.foreground }]}>EVIL SPOTIFY</Text>
            <Text style={[styles.brandTagline, { color: colors.mutedForeground }]}>
              MUSIC THAT’S YOURS
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan phone for MP3s"
          onPress={() => {
            tapFeedback();
            scanLibrary();
          }}
          style={({ pressed }) => [
            styles.scanIconButton,
            { backgroundColor: colors.secondary },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={libraryState === 'scanning' ? 'sync' : 'refresh'}
            size={20}
            color={colors.foreground}
          />
        </Pressable>
      </View>

      <View style={styles.pageHeading}>
        {page === 'playlists' && selectedPlaylist ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to playlists"
            onPress={closePlaylistDetail}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={20} color={colors.foreground} />
          </Pressable>
        ) : null}
        <View style={styles.headingText}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            {page === 'library' ? 'ALL LOCAL. ALL YOURS.' : page === 'playlists' ? 'MADE BY YOU.' : 'NO SIGNAL NEEDED.'}
          </Text>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>
            {page === 'playlists' && selectedPlaylist ? selectedPlaylist.name : screenTitle}
          </Text>
        </View>
        {page === 'playlists' && !selectedPlaylist ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create playlist"
            onPress={() => {
              setTrackToAdd(null);
              setCreateModalVisible(true);
            }}
            style={({ pressed }) => [
              styles.primaryRoundButton,
              { backgroundColor: colors.primary },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="add" size={23} color={colors.primaryForeground} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingBottom: bottomInset + (currentTrack && page !== 'nowPlaying' ? 164 : 96) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {notice ? (
          <Pressable onPress={() => setNotice('')} style={[styles.notice, { backgroundColor: colors.accent }]}>
            <Ionicons name="checkmark-circle" size={17} color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.accentForeground }]}>{notice}</Text>
            <Ionicons name="close" size={17} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

        {page === 'library' ? (
          <>
            <LinearGradient
              colors={[colors.accent, colors.card]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <View style={styles.heroCopy}>
                <Text style={[styles.heroKicker, { color: colors.primary }]}>YOUR PHONE. YOUR MUSIC.</Text>
                <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                  The good stuff{'\n'}stays offline.
                </Text>
                <Text style={[styles.heroSubtitle, { color: colors.mutedForeground }]}>
                  MP3s already on your phone, ready when you are.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={libraryState === 'scanning' ? 'Scanning for MP3s' : 'Scan phone for MP3s'}
                  disabled={libraryState === 'scanning'}
                  onPress={() => {
                    tapFeedback();
                    scanLibrary();
                  }}
                  style={({ pressed }) => [
                    styles.scanButton,
                    { backgroundColor: colors.primary },
                    pressed && styles.pressed,
                    libraryState === 'scanning' && styles.disabled,
                  ]}
                >
                  <Ionicons
                    name={libraryState === 'scanning' ? 'sync' : 'search'}
                    size={18}
                    color={colors.primaryForeground}
                  />
                  <Text style={[styles.scanButtonText, { color: colors.primaryForeground }]}>
                    {libraryState === 'scanning' ? 'Scanning your phone…' : tracks.length > 0 ? 'Scan again' : 'Find my MP3s'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.heroDiscWrap}>
                <View style={[styles.heroDiscOuter, { borderColor: colors.border }]}>
                  <View style={[styles.heroDisc, { backgroundColor: colors.primary }]}>
                    <View style={[styles.heroDiscInner, { backgroundColor: colors.background }]} />
                  </View>
                </View>
              </View>
            </LinearGradient>

            {libraryState === 'permission' || libraryState === 'blocked' ? (
              <View style={[styles.permissionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="folder-open-outline" size={22} color={colors.primary} />
                <View style={styles.permissionCopy}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    Music access is needed
                  </Text>
                  <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                    Allow access to audio files so the app can find your MP3s. It only reads your music library.
                  </Text>
                </View>
                {libraryState === 'blocked' ? (
                  <Pressable onPress={() => Linking.openSettings()} style={[styles.smallAction, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.smallActionText, { color: colors.foreground }]}>Settings</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={scanLibrary} style={[styles.smallAction, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.smallActionText, { color: colors.primaryForeground }]}>Try again</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {Platform.OS === 'web' ? (
              <View style={[styles.permissionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="phone-portrait-outline" size={22} color={colors.primary} />
                <View style={styles.permissionCopy}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    Scan music on your Android phone
                  </Text>
                  <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                    The browser preview can’t access files on your phone. Open the app on Android to find and play your MP3s.
                  </Text>
                </View>
              </View>
            ) : null}

            {libraryState === 'error' ? (
              <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="alert-circle-outline" size={22} color={colors.destructive} />
                <View style={styles.permissionCopy}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Couldn’t scan your music</Text>
                  <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                    {scanError || 'Check music access and try again.'}
                  </Text>
                </View>
                <Pressable onPress={scanLibrary} style={[styles.smallAction, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.smallActionText, { color: colors.foreground }]}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            {audioError ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{audioError}</Text>
            ) : null}

            {libraryState === 'ready' && tracks.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
                  <Ionicons name="musical-notes-outline" size={25} color={colors.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No MP3s found yet</Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  {libraryMessage}
                </Text>
                {otherAudioCount > 0 ? (
                  <Text style={[styles.fileHint, { color: colors.mutedForeground }]}>
                    Other audio formats aren’t included in this MP3 library.
                  </Text>
                ) : null}
                <Pressable onPress={scanLibrary} style={[styles.secondaryButton, { backgroundColor: colors.secondary }]}>
                  <Ionicons name="refresh" size={17} color={colors.foreground} />
                  <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Scan again</Text>
                </Pressable>
              </View>
            ) : null}

            {tracks.length > 0 ? (
              <>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>On this phone</Text>
                    <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
                      {tracks.length} MP3{tracks.length === 1 ? '' : 's'} · stored locally
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Play all songs"
                    onPress={() => startTrack(tracks[0], tracks)}
                    style={({ pressed }) => [
                      styles.playAllButton,
                      { backgroundColor: colors.primary },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="play" size={15} color={colors.primaryForeground} />
                    <Text style={[styles.playAllText, { color: colors.primaryForeground }]}>Play all</Text>
                  </Pressable>
                </View>
                <View style={styles.trackList}>
                  {tracks.map((track) => renderTrack(track, tracks))}
                </View>
              </>
            ) : null}

            {libraryState === 'idle' ? (
              <View style={[styles.trustNote, { backgroundColor: colors.card }]}>
                <Ionicons name="phone-portrait-outline" size={19} color={colors.primary} />
                <Text style={[styles.trustText, { color: colors.mutedForeground }]}>
                  Your songs and playlists stay on this device. No account or internet required.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {page === 'playlists' ? (
          selectedPlaylist ? (
            <>
              <View style={[styles.playlistHero, { backgroundColor: colors.card }]}>
                <View style={[styles.playlistArt, { backgroundColor: colors.primary }]}>
                  <Ionicons name="albums" size={30} color={colors.primaryForeground} />
                </View>
                <View style={styles.playlistHeroText}>
                  <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
                    {selectedPlaylist.trackIds.length} song{selectedPlaylist.trackIds.length === 1 ? '' : 's'}
                  </Text>
                  {selectedPlaylist.trackIds.length > 0 ? (
                    <Pressable
                      onPress={() => startTrack(visiblePlaylistTracks[0], visiblePlaylistTracks)}
                      disabled={visiblePlaylistTracks.length === 0}
                      style={({ pressed }) => [
                        styles.playAllButton,
                        { backgroundColor: colors.primary, alignSelf: 'flex-start', marginTop: 12 },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name="play" size={15} color={colors.primaryForeground} />
                      <Text style={[styles.playAllText, { color: colors.primaryForeground }]}>Play playlist</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {selectedPlaylistMissingCount > 0 ? (
                <Text style={[styles.bodyText, { color: colors.mutedForeground, marginBottom: 12 }]}>
                  {selectedPlaylistMissingCount} saved song{selectedPlaylistMissingCount === 1 ? ' is' : 's are'} no longer in the phone’s music library. Scan again to refresh.
                </Text>
              ) : null}
              {visiblePlaylistTracks.length > 0 ? (
                <View style={styles.trackList}>
                  {visiblePlaylistTracks.map((track) => renderTrack(track, visiblePlaylistTracks, true))}
                </View>
              ) : (
                <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
                    <Ionicons name="musical-notes-outline" size={25} color={colors.primary} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>This playlist is empty</Text>
                  <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                    Scan your phone for MP3s, then tap the plus beside a song to add it here.
                  </Text>
                  <Pressable
                    onPress={() => {
                      setPage('library');
                      scanLibrary();
                    }}
                    style={[styles.secondaryButton, { backgroundColor: colors.secondary }]}
                  >
                    <Ionicons name="search" size={17} color={colors.foreground} />
                    <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Find MP3s</Text>
                  </Pressable>
                </View>
              )}
            </>
          ) : playlists.length > 0 ? (
            <View style={styles.playlistList}>
              {playlists.map((playlist) => (
                <View
                  key={playlist.id}
                  style={[styles.playlistRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSelectedPlaylistId(playlist.id)}
                    style={({ pressed }) => [styles.playlistOpen, pressed && styles.pressed]}
                  >
                    <View style={[styles.playlistSmallArt, { backgroundColor: colors.accent }]}>
                      <Ionicons name="albums-outline" size={21} color={colors.primary} />
                    </View>
                    <View style={styles.playlistInfo}>
                      <Text numberOfLines={1} style={[styles.trackTitle, { color: colors.foreground }]}>
                        {playlist.name}
                      </Text>
                      <Text style={[styles.trackArtist, { color: colors.mutedForeground }]}>
                        {playlist.trackIds.length} song{playlist.trackIds.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={19} color={colors.mutedForeground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${playlist.name}`}
                    onPress={() => removePlaylist(playlist)}
                    hitSlop={10}
                    style={styles.rowAction}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
                <Ionicons name="albums-outline" size={25} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Make a playlist your own</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Create a playlist, then add songs from your phone’s MP3 library.
              </Text>
              <Pressable
                onPress={() => setCreateModalVisible(true)}
                style={[styles.scanButton, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="add" size={19} color={colors.primaryForeground} />
                <Text style={[styles.scanButtonText, { color: colors.primaryForeground }]}>Create playlist</Text>
              </Pressable>
              {tracks.length === 0 ? (
                <Pressable
                  onPress={() => {
                    setPage('library');
                    scanLibrary();
                  }}
                  style={styles.linkButton}
                >
                  <Text style={[styles.linkText, { color: colors.primary }]}>Scan for music first</Text>
                </Pressable>
              ) : null}
            </View>
          )
        ) : null}

        {page === 'nowPlaying' ? (
          currentTrack ? (
            <View style={styles.nowPlaying}>
              <LinearGradient
                colors={[colors.accent, colors.card]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.nowPlayingArtwork}
              >
                <View style={[styles.largeDiscOuter, { borderColor: colors.border }]}>
                  <View style={[styles.largeDisc, { backgroundColor: colors.primary }]}>
                    <View style={[styles.largeDiscInner, { backgroundColor: colors.background }]} />
                  </View>
                </View>
              </LinearGradient>
              <View style={styles.nowPlayingInfo}>
                <View style={styles.nowPlayingTitleBlock}>
                  <Text numberOfLines={2} style={[styles.nowPlayingTitle, { color: colors.foreground }]}>
                    {currentTrack.title}
                  </Text>
                  <Text numberOfLines={1} style={[styles.nowPlayingArtist, { color: colors.mutedForeground }]}>
                    {currentTrack.artist}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add this song to a playlist"
                  onPress={() => {
                    setTrackToAdd(currentTrack);
                    setPlaylistModalVisible(true);
                  }}
                  hitSlop={10}
                >
                  <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="adjustable"
                accessibilityLabel="Seek in track"
                onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
                onPress={(event) => seekFromTouch(event.nativeEvent.locationX)}
                style={[styles.progressTouch, { backgroundColor: colors.secondary }]}
              >
                <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
              </Pressable>
              <View style={styles.timeRow}>
                <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
                  {formatTime(playback.currentTime)}
                </Text>
                <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
                  {formatTime(duration)}
                </Text>
              </View>
              <View style={styles.controls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={repeatAll ? 'Turn repeat off' : 'Repeat all songs'}
                  onPress={() => setRepeatAll((current) => !current)}
                  style={styles.controlButton}
                >
                  <Ionicons
                    name="repeat"
                    size={22}
                    color={repeatAll ? colors.primary : colors.mutedForeground}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous track"
                  onPress={playPrevious}
                  style={styles.controlButton}
                >
                  <Ionicons name="play-skip-back" size={27} color={colors.foreground} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={playback.playing ? 'Pause' : 'Play'}
                  onPress={togglePlayback}
                  style={({ pressed }) => [
                    styles.mainPlayButton,
                    { backgroundColor: colors.primary },
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={playback.playing ? 'pause' : 'play'}
                    size={27}
                    color={colors.primaryForeground}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next track"
                  onPress={playNext}
                  style={styles.controlButton}
                >
                  <Ionicons name="play-skip-forward" size={27} color={colors.foreground} />
                </Pressable>
                <View style={[styles.controlButton, styles.queueCount]}>
                  <Ionicons name="list" size={20} color={colors.mutedForeground} />
                  <Text style={[styles.queueCountText, { color: colors.mutedForeground }]}>
                    {queue.length}
                  </Text>
                </View>
              </View>
              <View style={[styles.offlineBadge, { backgroundColor: colors.accent }]}>
                <Ionicons name="cloud-offline-outline" size={16} color={colors.primary} />
                <Text style={[styles.offlineText, { color: colors.accentForeground }]}>
                  Playing from your phone
                </Text>
              </View>
              {audioError ? (
                <Text style={[styles.errorText, { color: colors.destructive }]}>{audioError}</Text>
              ) : null}
            </View>
          ) : (
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
                <Ionicons name="headset-outline" size={25} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing playing yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Choose a song from your library to start listening offline.
              </Text>
              <Pressable
                onPress={() => goToPage('library')}
                style={[styles.secondaryButton, { backgroundColor: colors.secondary }]}
              >
                <Ionicons name="musical-notes" size={17} color={colors.foreground} />
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Open library</Text>
              </Pressable>
            </View>
          )
        ) : null}
      </ScrollView>

      {currentTrack && page !== 'nowPlaying' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open now playing: ${currentTrack.title}`}
          onPress={() => setPage('nowPlaying')}
          style={({ pressed }) => [
            styles.miniPlayer,
            { backgroundColor: colors.card, borderColor: colors.border, bottom: bottomInset + 68 },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.miniArtwork, { backgroundColor: colors.accent }]}>
            <Ionicons name="musical-note" size={18} color={colors.primary} />
          </View>
          <View style={styles.miniText}>
            <Text numberOfLines={1} style={[styles.miniTitle, { color: colors.foreground }]}>
              {currentTrack.title}
            </Text>
            <Text numberOfLines={1} style={[styles.miniArtist, { color: colors.mutedForeground }]}>
              {currentTrack.artist}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playback.playing ? 'Pause' : 'Play'}
            onPress={(event) => {
              event.stopPropagation();
              togglePlayback();
            }}
            hitSlop={10}
            style={styles.miniPlayButton}
          >
            <Ionicons
              name={playback.playing ? 'pause' : 'play'}
              size={22}
              color={colors.foreground}
            />
          </Pressable>
        </Pressable>
      ) : null}

      <View
        style={[
          styles.bottomNav,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: Math.max(bottomInset, 12),
          },
        ]}
      >
        {([
          ['library', 'Library', 'musical-notes-outline'],
          ['playlists', 'Playlists', 'albums-outline'],
          ['nowPlaying', 'Playing', 'headset-outline'],
        ] as const).map(([key, label, icon]) => {
          const active = page === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              onPress={() => goToPage(key)}
              style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
            >
              <Ionicons
                name={icon}
                size={21}
                color={active ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.navLabel,
                  { color: active ? colors.primary : colors.mutedForeground },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCreateModalVisible(false);
          setPlaylistName('');
          setTrackToAdd(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>New playlist</Text>
                <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
                  {trackToAdd ? `“${trackToAdd.title}” will be added.` : 'Give your mix a name.'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => {
                  setCreateModalVisible(false);
                  setPlaylistName('');
                  setTrackToAdd(null);
                }}
                hitSlop={10}
              >
                <Ionicons name="close" size={23} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              maxLength={40}
              placeholder="Playlist name"
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="done"
              value={playlistName}
              onChangeText={setPlaylistName}
              onSubmitEditing={createPlaylist}
              style={[
                styles.playlistInput,
                { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!playlistName.trim()}
              onPress={createPlaylist}
              style={({ pressed }) => [
                styles.modalPrimaryButton,
                { backgroundColor: colors.primary },
                !playlistName.trim() && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.scanButtonText, { color: colors.primaryForeground }]}>Create playlist</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={playlistModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setPlaylistModalVisible(false);
          setTrackToAdd(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add to playlist</Text>
                <Text numberOfLines={1} style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
                  {trackToAdd?.title ?? 'Choose where it belongs'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => {
                  setPlaylistModalVisible(false);
                  setTrackToAdd(null);
                }}
                hitSlop={10}
              >
                <Ionicons name="close" size={23} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {playlists.length > 0 ? (
              <FlatList
                data={playlists}
                keyExtractor={(item) => item.id}
                style={styles.modalPlaylistList}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => addTrackToPlaylist(item.id)}
                    style={({ pressed }) => [
                      styles.modalPlaylistRow,
                      { borderBottomColor: colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.playlistSmallArt, { backgroundColor: colors.accent }]}>
                      <Ionicons name="albums-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.playlistInfo}>
                      <Text style={[styles.trackTitle, { color: colors.foreground }]}>{item.name}</Text>
                      <Text style={[styles.trackArtist, { color: colors.mutedForeground }]}>
                        {item.trackIds.length} songs
                      </Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                  </Pressable>
                )}
              />
            ) : (
              <Text style={[styles.emptyModalText, { color: colors.mutedForeground }]}>
                You don’t have a playlist yet. Create one to save this song.
              </Text>
            )}
            <Pressable
              onPress={() => {
                setPlaylistModalVisible(false);
                setCreateModalVisible(true);
              }}
              style={[styles.modalSecondaryButton, { backgroundColor: colors.secondary }]}
            >
              <Ionicons name="add" size={18} color={colors.foreground} />
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Create new playlist</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    height: 62,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    letterSpacing: 1.6,
  },
  brandTagline: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    letterSpacing: 1.8,
    marginTop: 2,
  },
  scanIconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageHeading: {
    minHeight: 84,
    paddingHorizontal: 22,
    paddingTop: 15,
    paddingBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headingText: {
    flex: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.7,
  },
  pageTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    letterSpacing: -0.6,
    marginTop: 4,
  },
  primaryRoundButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 6,
    gap: 18,
  },
  hero: {
    minHeight: 222,
    borderRadius: 25,
    paddingHorizontal: 21,
    paddingVertical: 22,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroCopy: {
    flex: 1,
    zIndex: 1,
  },
  heroKicker: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.35,
  },
  heroTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.7,
    marginTop: 11,
  },
  heroSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 230,
    marginTop: 7,
  },
  scanButton: {
    minHeight: 43,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginTop: 15,
  },
  scanButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  heroDiscWrap: {
    width: 91,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -14,
    marginRight: -29,
  },
  heroDiscOuter: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDisc: {
    width: 83,
    height: 83,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDiscInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  permissionCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  permissionCopy: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  bodyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  smallAction: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 11,
    justifyContent: 'center',
  },
  smallActionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 18,
  },
  emptyState: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 11,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  emptyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 280,
  },
  fileHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 40,
    paddingHorizontal: 15,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  secondaryButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
  },
  sectionSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 4,
  },
  playAllButton: {
    minHeight: 35,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  playAllText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  trackList: {
    gap: 2,
    marginTop: -7,
  },
  trackRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trackMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  trackArtwork: {
    width: 45,
    height: 45,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  trackTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  trackArtist: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  trackDuration: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  rowAction: {
    width: 34,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.55,
  },
  trustNote: {
    borderRadius: 17,
    paddingHorizontal: 15,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  trustText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 17,
  },
  notice: {
    minHeight: 37,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 16,
  },
  playlistList: {
    gap: 10,
  },
  playlistRow: {
    minHeight: 76,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  playlistOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  playlistSmallArt: {
    width: 49,
    height: 49,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistInfo: {
    flex: 1,
    gap: 4,
  },
  playlistHero: {
    minHeight: 135,
    borderRadius: 20,
    padding: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 15,
  },
  playlistArt: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistHeroText: {
    flex: 1,
  },
  linkButton: {
    padding: 8,
  },
  linkText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  nowPlaying: {
    alignItems: 'stretch',
    paddingTop: 4,
  },
  nowPlayingArtwork: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 340,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
    overflow: 'hidden',
  },
  largeDiscOuter: {
    width: 212,
    height: 212,
    borderRadius: 106,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeDisc: {
    width: 170,
    height: 170,
    borderRadius: 85,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeDiscInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  nowPlayingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  nowPlayingTitleBlock: {
    flex: 1,
    gap: 6,
  },
  nowPlayingTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    lineHeight: 27,
  },
  nowPlayingArtist: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  progressTouch: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  timeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  controlButton: {
    width: 38,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainPlayButton: {
    width: 62,
    height: 62,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueCount: {
    flexDirection: 'row',
    gap: 3,
  },
  queueCountText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
  },
  offlineBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 22,
  },
  offlineText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  miniPlayer: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 62,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    elevation: 8,
  },
  miniArtwork: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  miniTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  miniArtist: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  miniPlayButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNav: {
    minHeight: 61,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  navLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.64)',
  },
  modalCard: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 21,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 17,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 19,
  },
  modalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 5,
  },
  playlistInput: {
    minHeight: 49,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  modalPrimaryButton: {
    minHeight: 47,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 13,
  },
  modalPlaylistList: {
    flexGrow: 0,
    marginBottom: 13,
  },
  modalPlaylistRow: {
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  emptyModalText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  modalSecondaryButton: {
    minHeight: 45,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
});
