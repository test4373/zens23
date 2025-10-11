import axios from "axios";
import { useRef, useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { Button } from "@radix-ui/themes";
import { toast } from "sonner";
import {
  ExclamationTriangleIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { watchAPI } from '../utils/api';
import CustomVideoPlayer from "../components/CustomVideoPlayer";
import DashVideoPlayer from "../components/DashVideoPlayer";
import SimpleVideoPlayer from "../components/SimpleVideoPlayer";
import EpisodesPlayer from "../components/EpisodesPlayer";
import CommentSection from "../components/CommentSection";

const BACKEND_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'https://zens23.onrender.com';

export default function Player() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const params = useParams();
  const magnetURI = params.magnetId;
  const currentEpisodeFromUrl = parseInt(params.currentEpisodeNum) || 1;
  const location = useLocation();
  const animeData = location.state?.data;
  const [animeId, setAnimeId] = useState(animeData?.id?.toString() || null);

  const [videoSrc, setVideoSrc] = useState("");
  const [subtitleSrc, setSubtitleSrc] = useState("");
  const [availableSubtitles, setAvailableSubtitles] = useState([]);
  const [availableAudioTracks, setAvailableAudioTracks] = useState([]);
  const [files, setFiles] = useState([]);
  const [currentEpisode, setCurrentEpisode] = useState("");
  const [currentEpisodeNum, setCurrentEpisodeNum] = useState(currentEpisodeFromUrl);
  const [lastProgressUpdate, setLastProgressUpdate] = useState(0);
  const [watchStartTime, setWatchStartTime] = useState(null);
  const [totalWatchTime, setTotalWatchTime] = useState(0);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);
  const [quality, setQuality] = useState('1080p');
  const [upscaleAvailable, setUpscaleAvailable] = useState(false);
  const [upscaleFiles, setUpscaleFiles] = useState([]);
  const [originalVideoSrc, setOriginalVideoSrc] = useState("");
  const useHlsMode = false; // Direct MKV streaming for better compatibility
  const savedProgressRef = useRef(0);
  const progressUpdateIntervalRef = useRef(null);
  const [idmWarningShown, setIdmWarningShown] = useState(false);

  useEffect(() => {
    const warned = sessionStorage.getItem('idm_warning_shown');
    if (!warned && !idmWarningShown) {
      setIdmWarningShown(true);
      sessionStorage.setItem('idm_warning_shown', 'true');
      setTimeout(() => {
        toast.warning('⚠️ IDM/Download Manager', {
          description: 'Video için IDM kapatın',
          duration: 5000
        });
      }, 2000);
    }
  }, [idmWarningShown]);

  useEffect(() => {
    if (!animeId && magnetURI) {
      const decodedMagnet = decodeURIComponent(magnetURI);
      const hash = decodedMagnet.split('&')[0].replace('magnet:?xt=urn:btih:', '');
      setAnimeId(hash.substring(0, 10));
    }
  }, [magnetURI, animeId]);

  useEffect(() => {
    const fetchSavedProgress = async () => {
      if (isAuthenticated && animeData?.id && magnetURI && currentEpisodeNum) {
        try {
          const response = await watchAPI.getHistory();
          const history = response.data.data || [];
          const savedAnime = history.find(
            item => item.anime_id === animeData.id.toString() && 
                   item.magnet_uri === magnetURI &&
                   item.episode_number === currentEpisodeNum
          );
          if (savedAnime && savedAnime.current_time > 0) {
            const timeToUse = savedAnime.current_time;
            setSavedProgress(timeToUse);
            savedProgressRef.current = timeToUse;
          }
        } catch (error) {
          console.error('Error fetching saved progress:', error);
        }
      }
    };
    fetchSavedProgress();
  }, [isAuthenticated, animeData?.id, magnetURI, currentEpisodeNum]);

  useEffect(() => {
    return () => {
      if (progressUpdateIntervalRef.current) {
        clearInterval(progressUpdateIntervalRef.current);
      }
    };
  }, [isAuthenticated, animeData, currentEpisodeNum, animeId, magnetURI]);

  const getFiles = async () => {
    if (files && files.length > 0) return Promise.resolve();
    setLoadingFiles(true);
    try {
      const response = await axios.get(
        `${BACKEND_URL}/metadata/${encodeURIComponent(magnetURI)}`
      );
      const data = await response.data;
      setFiles(data);
      return Promise.resolve();
    } catch (error) {
      toast.error(t("backendNotRunningOrNoFiles") || "Backend error");
      return Promise.reject(error);
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleVideoTimeUpdate = async (currentTime, duration) => {
    if (!isAuthenticated || !animeData) return;
    const progress = (currentTime / duration) * 100;
    if (Math.abs(currentTime - lastProgressUpdate) >= 1) {
      setLastProgressUpdate(currentTime);
      await updateWatchHistory(progress, currentTime, false);
    }
  };

  const handleQualityChange = (newQuality) => {
    setQuality(newQuality);
    if (currentEpisode) {
      let newVideoUrl;
      if (newQuality === '4K' && upscaleAvailable && upscaleFiles.length > 0) {
        const anime = 'DandadanS02E01';
        const ep = 'DandadanS02E01';
        const filename = upscaleFiles[0].name;
        newVideoUrl = `${BACKEND_URL}/stream-upscale/${encodeURIComponent(anime)}/${encodeURIComponent(ep)}/${encodeURIComponent(filename)}`;
        toast.success('🌟 4K Upscale Aktif!');
      } else {
        newVideoUrl = originalVideoSrc;
        toast.info('📺 1080p HD');
      }
      setVideoSrc(newVideoUrl);
    }
  };

  const updateWatchHistory = async (progress, currentTimeSeconds, forceUpdate = false) => {
    if (!isAuthenticated || !animeData) return;
    if (!forceUpdate && Math.abs(currentTimeSeconds - lastProgressUpdate) < 0.5) return;

    try {
      const now = Date.now();
      let watchTimeDelta = 10;
      if (watchStartTime) {
        watchTimeDelta = Math.floor((now - watchStartTime) / 1000);
      }
      setWatchStartTime(now);
      setTotalWatchTime(prev => prev + watchTimeDelta);
      setLastProgressUpdate(currentTimeSeconds);

      const historyData = {
        animeId: animeData.id?.toString() || animeId,
        animeTitle: animeData.title?.romaji || animeData.title?.english || 'Unknown Anime',
        animeImage: animeData.coverImage?.extraLarge || animeData.coverImage?.large || '',
        episodeNumber: currentEpisodeNum,
        progress: Math.round(progress),
        currentTime: currentTimeSeconds,
        magnetUri: magnetURI,
        watchTime: watchTimeDelta
      };

      await watchAPI.addToHistory(historyData);
    } catch (error) {
      console.error('Update failed:', error);
    }
  };

  useEffect(() => {
    const checkUpscale = async () => {
      try {
        const anime = 'DandadanS02E01';
        const episode = 'DandadanS02E01';
        const response = await axios.get(
          `${BACKEND_URL}/upscale-available/${encodeURIComponent(anime)}/${encodeURIComponent(episode)}`
        );
        if (response.data.available && response.data.files.length > 0) {
          setUpscaleAvailable(true);
          setUpscaleFiles(response.data.files);
        }
      } catch (error) {
        console.error('Error checking upscale:', error);
      }
    };
    checkUpscale();
  }, [currentEpisodeNum]);

  const handleStreamBrowser = async (episode, selectedQuality = null) => {
    const useQuality = selectedQuality || quality;
    const episodeMatch = episode.match(/(\d+)/);
    const episodeNumber = episodeMatch ? parseInt(episodeMatch[1]) : 1;
    if (episodeNumber === currentEpisodeNum && videoSrc) return;

    try {
      await axios.get(`${BACKEND_URL}/add/${encodeURIComponent(magnetURI)}`);
    } catch (error) {
      toast.error(t('player.torrentAddFailed') || 'Torrent error');
      return;
    }
    
    setCurrentEpisodeNum(episodeNumber);
    setLastProgressUpdate(0);

    const bypassParam = `?nocache=${Date.now()}`;
    
    // 🎬 Use HLS for better subtitle support and adaptive streaming
    let videoUrl;
    if (useHlsMode) {
      // HLS master playlist URL - Fixed to use master.m3u8
      videoUrl = `${BACKEND_URL}/hls/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}/master.m3u8`;
      toast.success('🎬 HLS Streaming Aktif', { description: 'Altyazı desteği geliştirildi' });
    } else {
      // Direct streaming (fallback)
      const original1080pUrl = `${BACKEND_URL}/streamfile/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}${bypassParam}`;
      setOriginalVideoSrc(original1080pUrl);
      
      if (useQuality === '4K' && upscaleAvailable && upscaleFiles.length > 0) {
        const anime = 'DandadanS02E01';
        const ep = 'DandadanS02E01';
        const filename = upscaleFiles[0].name;
        videoUrl = `${BACKEND_URL}/stream-upscale/${encodeURIComponent(anime)}/${encodeURIComponent(ep)}/${encodeURIComponent(filename)}${bypassParam}`;
      } else {
        videoUrl = original1080pUrl;
      }
    }
    
    setVideoSrc(videoUrl);

    // 🔥 Fetch ALL subtitle and audio tracks from MKV
    try {
      const tracksResponse = await axios.get(`${BACKEND_URL}/tracks/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}`);
      const { subtitles, audio } = tracksResponse.data;

      console.log('📝 Available subtitles from MKV:', subtitles);
      console.log('🔊 Available audio tracks from MKV:', audio);

      // Set audio tracks
      if (audio && audio.length > 0) {
        const audioList = audio.map((track, index) => ({
          label: track.title || `${track.language || 'Unknown'} Audio ${index + 1}`,
          lang: track.language || 'unknown',
          index: track.index
        }));
        setAvailableAudioTracks(audioList);
      } else {
        setAvailableAudioTracks([]);
        toast.warning('⚠️ Bu videoda ses izi bulunamadı. Dosya bozuk olabilir.', { duration: 5000 });
      }
      
      if (subtitles && subtitles.length > 0) {
        // Build subtitle list with URLs
        const subtitleList = subtitles.map((sub, index) => ({
          src: `${BACKEND_URL}/subtitle/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}/${index}`,
          lang: sub.language || 'unknown',
          label: sub.title || `${sub.language || 'Unknown'} ${sub.codec ? `(${sub.codec})` : ''}`
        }));
        
        console.log('📝 Subtitle list:', subtitleList);
        
        // Set all subtitles to availableSubtitles state
        setAvailableSubtitles(subtitleList);
        
        // Set first subtitle as default (for backward compatibility)
        if (subtitleList.length > 0) {
          setSubtitleSrc(subtitleList[0].src);
        }
      } else {
        // Fallback to default subtitle endpoint
        const subtitleUrl = `${BACKEND_URL}/subtitles/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}`;
        setSubtitleSrc(subtitleUrl);
        setAvailableSubtitles([{
          src: subtitleUrl,
          lang: 'en',
          label: 'English'
        }]);
      }
    } catch (error) {
      console.error('Error fetching tracks:', error);
      // Fallback to default subtitle endpoint
      const subtitleUrl = `${BACKEND_URL}/subtitles/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}`;
      setSubtitleSrc(subtitleUrl);
      setAvailableSubtitles([{
        src: subtitleUrl,
        lang: 'en',
        label: 'English'
      }]);
    }

    if (isAuthenticated && animeData) {
      try {
        setWatchStartTime(Date.now());
        setTotalWatchTime(0);
        setLastProgressUpdate(0);

        let savedTime = 0;
        const response = await watchAPI.getHistory();
        const history = response.data.data || [];
        const savedAnime = history.find(
          item => item.anime_id === animeData.id.toString() && 
                 item.magnet_uri === magnetURI &&
                 item.episode_number === episodeNumber
        );
        if (savedAnime && savedAnime.current_time > 0) {
          savedTime = savedAnime.current_time;
        }
        setSavedProgress(savedTime);
        savedProgressRef.current = savedTime;
      } catch (error) {
        console.error('Tracking failed:', error);
      }
    }
  };

  const handleStreamVlc = async (episode) => {
    try {
      await axios.get(
        `${BACKEND_URL}/stream-to-vlc?url=${encodeURIComponent(
          `${BACKEND_URL}/streamfile/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}`
        )}`
      );
      toast.success(t('player.vlcLaunched'));
    } catch (error) {
      toast.error(t("errorStreamingToVLC") || "VLC error");
    }
  };

  const handleStreamMpv = async (episode) => {
    try {
      const videoUrl = `${BACKEND_URL}/streamfile/${encodeURIComponent(magnetURI)}/${encodeURIComponent(episode)}`;
      await axios.get(`${BACKEND_URL}/stream-to-mpv?url=${encodeURIComponent(videoUrl)}`);
      toast.success(t('player.mpvLaunched'));
    } catch (error) {
      toast.error(t('player.mpvFailed'));
    }
  };

  const handleRemoveTorrent = async () => {
    setVideoSrc("");
    setSubtitleSrc("");
    setCurrentEpisode("");
    setOriginalVideoSrc("");

    try {
      await axios.delete(`${BACKEND_URL}/remove/${encodeURIComponent(magnetURI)}`);
    } catch (error) {
      if (error.response?.status !== 404) {
        console.error("Error removing torrent", error);
      }
    }
    toast.success(t("player.videoStopped") || "Video stopped");
  };

  useEffect(() => {
    const autoLoad = async () => {
      if (magnetURI && (!files || files.length === 0)) {
        try {
          await getFiles();
        } catch (error) {
          console.error('Auto-load failed:', error);
        }
      }
    };
    autoLoad();
  }, [magnetURI]);

  useEffect(() => {
    if (videoSrc && currentEpisode) {
      handleStreamBrowser(currentEpisode, quality);
    }
  }, [quality]);

  const playerWrapperRef = useRef(null);

  return (
    <div className="flex flex-col items-center justify-center font-space-mono">
      {videoSrc && (
      <div className="w-full max-w-7xl mb-6 px-4" ref={playerWrapperRef}>
        <CustomVideoPlayer
              videoSrc={videoSrc}
              subtitleSrc={subtitleSrc}
              magnet={magnetURI}
              filename={currentEpisode}
              onTimeUpdate={handleVideoTimeUpdate}
              initialTime={savedProgress}
              quality={quality}
              onQualityChange={handleQualityChange}
              upscaleAvailable={upscaleAvailable}
              originalVideoSrc={originalVideoSrc}
              availableQualities={['1080p', '4K']}
              availableSubtitles={availableSubtitles}
              availableAudioTracks={availableAudioTracks}
              isHls={useHlsMode}
            />
        </div>
      )}

      <div className="w-full max-w-6xl px-4">
        {loadingFiles && (
          <div className="text-center py-12 border border-gray-700 rounded-lg bg-[#1d1d20]">
            <p className="text-lg text-gray-400 animate-pulse">📂 {t('player.loadingFiles') || 'Yükleniyor...'}</p>
          </div>
        )}

        {videoSrc && (
          <div className="mb-4 p-3 bg-gradient-to-r from-blue-900/30 to-violet-900/30 border border-blue-500/40 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <div className="text-sm font-bold text-blue-400">{t('player.directMkvStreaming')}</div>
                  <div className="text-xs text-gray-400">{t('player.instantPlayback')}</div>
                </div>
              </div>
              <span className="px-2 py-1 bg-blue-600/80 text-white text-xs font-bold rounded">✅ Ready</span>
            </div>
          </div>
        )}

        {!loadingFiles && files && files.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold mb-4 px-2">{t('player.episodes') || 'Bölümler'}</h2>
            {files.map((file, index) => (
              <EpisodesPlayer
                key={file.name || index}
                file={file}
                handleStreamBrowser={handleStreamBrowser}
                handleStreamVlc={handleStreamVlc}
                handleStreamMpv={handleStreamMpv}
                setCurrentEpisode={setCurrentEpisode}
                getFiles={getFiles}
                handleRemoveTorrent={handleRemoveTorrent}
                videoSrc={videoSrc}
              />
            ))}
          </div>
        )}

        {!loadingFiles && (!files || files.length === 0) && (
          <div className="text-center py-12 border border-gray-700 rounded-lg bg-[#1d1d20]">
            <p className="text-gray-400 mb-4">⚠️ {t('player.noFilesFound') || 'Dosya yok'}</p>
            <Button onClick={getFiles} size="3" color="blue" variant="solid">
              {t('player.tryAgain') || 'Tekrar Dene'}
            </Button>
          </div>
        )}

        {isAuthenticated && animeId && (
          <div className="mt-8 border border-gray-700 bg-[#1d1d20] p-6 rounded-lg">
            <CommentSection animeId={animeId} />
          </div>
        )}
      </div>
    </div>
  );
}
