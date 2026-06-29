      let tracks = [];
      let curIdx = -1;
      let playing = false;
      let raf = null;
      let visualLevels = [];
      let currentSpeed = 1.0;
      let speedPanelOpen = false;
      let isFullscreen = false;
      let currentOrientation = 'landscape';

      // Fade-in / Fade-out parameters
      let activeFadeInterval = null;
      let fadeInTime = 1.0;
      let fadeOutTime = 1.0;
      let fadeInEnabled = true;   // saklar on/off fade in
      let fadeOutEnabled = true;  // saklar on/off fade out
      let endFadeOutTriggered = false;

      function toggleFade(enabled) {
        fadeInEnabled = enabled;
        fadeOutEnabled = enabled;
        const wrap = document.getElementById('fadeAllControls');
        if (wrap) wrap.classList.toggle('disabled', !enabled);
      }

      function getTargetVolume() {
        return parseFloat(document.getElementById('volSlider').value);
      }

      function fadeVolume(target, duration, onComplete) {
        if (activeFadeInterval) {
          clearInterval(activeFadeInterval);
          activeFadeInterval = null;
        }

        if (duration <= 0) {
          audio.volume = target;
          if (onComplete) onComplete();
          return;
        }

        const startVol = audio.volume;
        const diff = target - startVol;
        const stepTime = 30; // 30ms step
        const steps = (duration * 1000) / stepTime;
        let step = 0;

        activeFadeInterval = setInterval(() => {
          step++;
          audio.volume = Math.max(0, Math.min(1, startVol + diff * (step / steps)));
          if (step >= steps) {
            clearInterval(activeFadeInterval);
            activeFadeInterval = null;
            audio.volume = target;
            if (onComplete) onComplete();
          }
        }, stepTime);
      }

      function playWithFade() {
        const target = getTargetVolume();
        
        // If the audio is currently paused or volume is 0, start from 0
        if (audio.paused || audio.volume === 0) {
          audio.volume = fadeInEnabled ? 0 : target;
        }
        
        audio.play().then(() => {
          applySpeed(currentSpeed);
        }).catch(e => console.log("Play failed:", e));

        playing = true;
        syncBtn();
        document.getElementById('playerSection').classList.add('visible');
        document.body.classList.add('has-player');
        document.getElementById('playerCard').classList.add('playing');
        document.getElementById('btnPlay').classList.add('pulsing');
        if (!raf) raf = requestAnimationFrame(draw);
        renderTracks();

        fadeVolume(target, fadeInEnabled ? fadeInTime : 0);
      }

      function pauseWithFade() {
        playing = false;
        document.getElementById('playerCard').classList.remove('playing');
        document.getElementById('btnPlay').classList.remove('pulsing');
        syncBtn();
        renderTracks();

        fadeVolume(0, fadeOutEnabled ? fadeOutTime : 0, () => {
          if (!playing) {
            audio.pause();
          }
        });
      }

      function playTrackWithFade(idx) {
        if (playing) {
          fadeVolume(0, fadeOutEnabled ? fadeOutTime : 0, () => {
            if (activeFadeInterval) {
              clearInterval(activeFadeInterval);
              activeFadeInterval = null;
            }
            loadTrack(idx);
          });
        } else {
          loadTrack(idx);
        }
      }

      function updateFadeIn(val) {
        fadeInTime = parseFloat(val);
        document.getElementById('fadeInVal').textContent = fadeInTime.toFixed(1) + 's';
      }

      function updateFadeOut(val) {
        fadeOutTime = parseFloat(val);
        document.getElementById('fadeOutVal').textContent = fadeOutTime.toFixed(1) + 's';
      }

      const audio = document.getElementById('audioEl');
      const canvas = document.getElementById('visCanvas');
      const cx = canvas.getContext('2d');

      const numBars = 72;
      const placeholderWaveform = (function() {
        const arr = [];
        for (let i = 0; i < numBars; i++) {
          const factor = Math.sin((i / numBars) * Math.PI);
          arr.push(0.15 + 0.5 * factor * (0.8 + 0.2 * Math.sin(i * 0.3)));
        }
        return arr;
      })();

      async function generateWaveform(file, numBars = 72) {
        try {
          const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
          const arrayBuffer = await file.arrayBuffer();
          const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
          tempCtx.close();
          
          const rawData = audioBuffer.getChannelData(0);
          const samplesPerBin = Math.floor(rawData.length / numBars);
          const peaks = [];
          
          for (let i = 0; i < numBars; i++) {
            let start = i * samplesPerBin;
            let end = start + samplesPerBin;
            let max = 0;
            for (let j = start; j < end; j++) {
              const val = Math.abs(rawData[j]);
              if (val > max) max = val;
            }
            peaks.push(max);
          }
          
          const maxPeak = Math.max(...peaks);
          if (maxPeak > 0) {
            return peaks.map(p => Math.max(0.08, p / maxPeak));
          }
          return new Array(numBars).fill(0.15);
        } catch (e) {
          console.error("Gagal mengekstrak waveform:", e);
          return placeholderWaveform;
        }
      }

      function resizeCv() {
        const w = canvas.parentElement;
        if (!w) return;
        // Use clientWidth and clientHeight to match the inner visualizer-wrap dimensions (excluding borders)
        canvas.width = w.clientWidth * devicePixelRatio;
        canvas.height = w.clientHeight * devicePixelRatio;
      }
      window.addEventListener('resize', resizeCv);
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          resizeCv();
        });
        ro.observe(canvas.parentElement);
      }

      function applySpeed(speed) {
        audio.preservesPitch = false;
        audio.mozPreservesPitch = false;
        audio.webkitPreservesPitch = false;
        audio.playbackRate = speed;
        setTimeout(() => {
          audio.preservesPitch = false;
          audio.mozPreservesPitch = false;
          audio.webkitPreservesPitch = false;
        }, 50);
      }

      audio.addEventListener('ratechange', () => {
        audio.preservesPitch = false;
        audio.mozPreservesPitch = false;
        audio.webkitPreservesPitch = false;
      });

      let audioCtx = null,
        analyser = null,
        srcNode = null;

      function initAudio() {
        if (audioCtx) return;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        srcNode = audioCtx.createMediaElementSource(audio);
        srcNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        audio.preservesPitch = false;
        audio.mozPreservesPitch = false;
        audio.webkitPreservesPitch = false;
      }

      function draw() {
        // Use clientWidth and clientHeight of the canvas element (matching the parent's content size)
        const W = canvas.clientWidth,
          H = canvas.clientHeight;
        cx.clearRect(0, 0, canvas.width, canvas.height);
        cx.save();
        cx.scale(devicePixelRatio, devicePixelRatio);

        const bars = 72,
          gap = 2,
          bw = (W - gap * (bars - 1)) / bars;
        const prog = audio.duration ? audio.currentTime / audio.duration : 0;
        const filledBars = Math.floor(prog * bars);

        if (visualLevels.length !== bars) visualLevels = new Array(bars).fill(3);
        const targetLevels = new Array(bars).fill(3);

        const activeTrack = curIdx >= 0 ? tracks[curIdx] : null;
        const wave = (activeTrack && Array.isArray(activeTrack.waveform)) ? activeTrack.waveform : placeholderWaveform;

        let buf = null;
        if (analyser && playing) {
          buf = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(buf);
        }

        const usableLength = buf ? Math.floor(buf.length * 0.65) : 0;

        for (let i = 0; i < bars; i++) {
          const baseHeight = wave[i] * (H - 12);
          if (buf && playing) {
            const rawVal = buf[Math.floor((i * usableLength) / bars)] / 255;
            targetLevels[i] = Math.max(4, baseHeight * (0.4 + 0.8 * Math.pow(rawVal, 1.2)) + rawVal * 8);
          } else {
            targetLevels[i] = 3;
          }
        }

        for (let i = 0; i < bars; i++) {
          visualLevels[i] += (targetLevels[i] - visualLevels[i]) * 0.14;
          const h = visualLevels[i];
          const played = i < filledBars;
          if (played) {
            const g = cx.createLinearGradient(0, (H - h) / 2, 0, (H + h) / 2);
            g.addColorStop(0, '#f5dfa8');
            g.addColorStop(1, '#c8a96e');
            cx.fillStyle = g;
          } else {
            const alpha = 0.12 + (h / (H - 4)) * 0.28;
            cx.fillStyle = `rgba(200,169,110,${alpha})`;
          }
          cx.beginPath();
          cx.roundRect((bw + gap) * i, (H - h) / 2, bw, h, 2);
          cx.fill();
        }

        if (audio.duration) {
          const x = prog * W;

          // Efek glow menggunakan gradasi warna emas
          const grad = cx.createLinearGradient(x - 8, 0, x + 8, 0);
          grad.addColorStop(0, 'rgba(200, 169, 110, 0)');
          grad.addColorStop(0.5, 'rgba(200, 169, 110, 0.35)');
          grad.addColorStop(1, 'rgba(200, 169, 110, 0)');

          cx.fillStyle = grad;
          cx.fillRect(x - 8, 0, 16, H);

          // Garis putih utama di tengah
          cx.beginPath();
          cx.moveTo(x, 0);
          cx.lineTo(x, H);
          cx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          cx.lineWidth = 2;
          cx.stroke();
        }

        cx.restore();
        raf = requestAnimationFrame(draw);
      }

      document.getElementById('seekOverlay').addEventListener('click', e => {
        if (!audio.duration) return;
        const r = e.currentTarget.getBoundingClientRect();
        audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
      });

      let isSeeking = false;
      document
        .getElementById('seekOverlay')
        .addEventListener('mousedown', () => (isSeeking = true));
      document.getElementById('seekOverlay').addEventListener('mousemove', e => {
        if (!isSeeking || !audio.duration) return;
        const r = e.currentTarget.getBoundingClientRect();
        audio.currentTime =
          Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) *
          audio.duration;
      });
      document.addEventListener('mouseup', () => (isSeeking = false));

      document.getElementById('seekOverlay').addEventListener(
        'touchmove',
        e => {
          if (!audio.duration) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const touch = e.touches[0];
          audio.currentTime =
            Math.max(0, Math.min(1, (touch.clientX - r.left) / r.width)) *
            audio.duration;
        },
        { passive: false }
      );

      function fmt(s) {
        if (!s || isNaN(s)) return '0:00';
        return (
          Math.floor(s / 60) +
          ':' +
          String(Math.floor(s % 60)).padStart(2, '0')
        );
      }

      function cleanName(f) {
        return f
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function updateTitleMarquee() {
        const titleEl = document.getElementById('npTitle');
        titleEl.scrollLeft = 0;
        const text = titleEl.textContent.trim();
        titleEl.innerHTML = `<span class="np-title-text">${text}</span>`;
        requestAnimationFrame(() => {
          const inner = titleEl.querySelector('.np-title-text');
          if (!inner) return;
          const overflow = inner.scrollWidth > titleEl.clientWidth + 2;
          if (overflow) {
            const distance = inner.scrollWidth - titleEl.clientWidth + 24;
            const duration = Math.max(8, distance / 20);
            titleEl.style.setProperty('--marquee-distance', `${distance}px`);
            titleEl.style.setProperty('--marquee-duration', `${duration}s`);
            titleEl.classList.add('marquee');
          } else {
            titleEl.classList.remove('marquee');
            titleEl.style.removeProperty('--marquee-distance');
            titleEl.style.removeProperty('--marquee-duration');
          }
        });
      }

      function decodeId3Text(data, encoding) {
        const bytes = new Uint8Array(data);
        let text = '';
        if (encoding === 0) text = new TextDecoder('iso-8859-1').decode(bytes);
        else if (encoding === 1 || encoding === 2)
          text = new TextDecoder('utf-16').decode(bytes);
        else if (encoding === 3) text = new TextDecoder('utf-8').decode(bytes);
        return text.replace(/\0/g, '').trim();
      }

      function syncSafeToInt(a, b, c, d) {
        return (
          ((a & 0x7f) << 21) |
          ((b & 0x7f) << 14) |
          ((c & 0x7f) << 7) |
          (d & 0x7f)
        );
      }

      async function getId3Tags(file) {
        return new Promise(res => {
          const fr = new FileReader();
          fr.onload = e => {
            try {
              const buf = e.target.result,
                v = new DataView(buf);
              if (
                !(
                  v.getUint8(0) === 0x49 &&
                  v.getUint8(1) === 0x44 &&
                  v.getUint8(2) === 0x33
                )
              ) {
                res({});
                return;
              }
              const ver = v.getUint8(3);
              const tagSize = syncSafeToInt(
                v.getUint8(6),
                v.getUint8(7),
                v.getUint8(8),
                v.getUint8(9)
              );
              let off = 10;
              const tags = {};
              while (off + 10 <= 10 + tagSize) {
                const id = String.fromCharCode(
                  v.getUint8(off),
                  v.getUint8(off + 1),
                  v.getUint8(off + 2),
                  v.getUint8(off + 3)
                );
                if (!/^[A-Z0-9]{4}$/.test(id)) break;
                const size =
                  ver === 4
                    ? syncSafeToInt(
                        v.getUint8(off + 4),
                        v.getUint8(off + 5),
                        v.getUint8(off + 6),
                        v.getUint8(off + 7)
                      )
                    : v.getUint32(off + 4);
                if (size <= 0) break;
                const frameStart = off + 10;
                if (frameStart + size > buf.byteLength) break;
                const encoding = v.getUint8(frameStart);
                const frameData = buf.slice(frameStart + 1, frameStart + size);
                if (id === 'TIT2' || id === 'TPE1' || id === 'TPE2') {
                  tags[id] = decodeId3Text(frameData, encoding);
                }
                off += 10 + size;
              }
              res(tags);
            } catch {
              res({});
            }
          };
          fr.readAsArrayBuffer(file.slice(0, 600000));
        });
      }

      function parseTrackMeta(filename, tags) {
        let title = tags.TIT2 || cleanName(filename);
        let artist = tags.TPE1 || tags.TPE2 || '';
        if (!artist) {
          const patterns = [
            /^(.+?)\s[-–|]\s(.+)$/,
            /^(.+?)\sby\s(.+)$/i,
            /^(.+?)\sft\.?\s(.+)$/i
          ];
          for (const pattern of patterns) {
            const match = cleanName(filename).match(pattern);
            if (match) {
              artist = match[1].trim();
              title = match[2].trim();
              break;
            }
          }
        }
        return { title, artist: artist || 'Unknown Artist' };
      }

      async function getCover(file) {
        return new Promise(res => {
          const fr = new FileReader();
          fr.onload = e => {
            try {
              const buf = e.target.result,
                v = new DataView(buf);
              if (
                v.getUint8(0) === 0x49 &&
                v.getUint8(1) === 0x44 &&
                v.getUint8(2) === 0x33
              ) {
                const sz =
                  ((v.getUint8(6) & 0x7f) << 21) |
                  ((v.getUint8(7) & 0x7f) << 14) |
                  ((v.getUint8(8) & 0x7f) << 7) |
                  (v.getUint8(9) & 0x7f);
                let off = 10;
                while (off < sz + 10 - 10) {
                  const fid = String.fromCharCode(
                    v.getUint8(off),
                    v.getUint8(off + 1),
                    v.getUint8(off + 2),
                    v.getUint8(off + 3)
                  );
                  const fsz = v.getUint32(off + 4);
                  off += 10;
                  if (fid === 'APIC') {
                    let i = off + 1;
                    while (v.getUint8(i) !== 0) i++;
                    i++;
                    i++;
                    while (v.getUint8(i) !== 0) i++;
                    i++;
                    res(
                      URL.createObjectURL(
                        new Blob([new Uint8Array(buf, i, fsz - (i - off))])
                      )
                    );
                    return;
                  }
                  off += fsz;
                }
              }
              res(null);
            } catch {
              res(null);
            }
          };
          fr.readAsArrayBuffer(file.slice(0, 600000));
        });
      }

      function resetBackground() {
        document.documentElement.style.removeProperty('--bg');
        document.documentElement.style.removeProperty('--bg2');
        ['amb1', 'amb2', 'amb3'].forEach(id => {
          document.getElementById(id).style.background =
            'rgba(200,169,110,0.15)';
        });
      }

      function setAmbient(imgEl) {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 16;
          const x = c.getContext('2d');
          x.drawImage(imgEl, 0, 0, 16, 16);
          const d = x.getImageData(0, 0, 16, 16).data;
          let r = 0,
            g = 0,
            b = 0,
            n = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i];
            g += d[i + 1];
            b += d[i + 2];
            n++;
          }
          const avgR = r / n;
          const avgG = g / n;
          const avgB = b / n;

          // Hitung warna background gelap yang elegan (maksimal kecerahan sangat rendah)
          const darkR = Math.max(5, Math.round(avgR * 0.08));
          const darkG = Math.max(5, Math.round(avgG * 0.08));
          const darkB = Math.max(8, Math.round(avgB * 0.1));
          const bgCol = `rgb(${darkR}, ${darkG}, ${darkB})`;

          const darkR2 = Math.max(8, Math.round(avgR * 0.12));
          const darkG2 = Math.max(8, Math.round(avgG * 0.12));
          const darkB2 = Math.max(12, Math.round(avgB * 0.15));
          const bgCol2 = `rgb(${darkR2}, ${darkG2}, ${darkB2})`;

          document.documentElement.style.setProperty('--bg', bgCol);
          document.documentElement.style.setProperty('--bg2', bgCol2);

          // Boost warna agar lebih nge-jreng untuk efek liquid
          const col = `rgba(${~~Math.min(avgR * 1.5, 255)},${~~Math.min(
            avgG * 1.5,
            255
          )},${~~Math.min(avgB * 1.5, 255)}`;
          document.getElementById('amb1').style.background = col + ', 0.25)';
          document.getElementById('amb2').style.background = col + ', 0.15)';
          document.getElementById('amb3').style.background = col + ', 0.1)';
        } catch {
          resetBackground();
        }
        ['amb1', 'amb2', 'amb3'].forEach(id =>
          document.getElementById(id).classList.add('on')
        );
      }

      function scrollToPlayerSection() {
        const playerSection = document.getElementById('playerSection');
        if (!playerSection) return;
        const top =
          playerSection.getBoundingClientRect().top + window.pageYOffset - 24;
        window.scrollTo({ top, behavior: 'smooth' });
      }

      // Simpan referensi parent asli speed panel
      let _speedPanelOriginalParent = null;
      let _speedPanelNextSibling = null;

      function _teleportSpeedPanel(toBody) {
        const panel = document.getElementById('speedPanel');
        if (!panel) return;
        if (toBody) {
          if (panel.parentElement !== document.body) {
            _speedPanelOriginalParent = panel.parentElement;
            _speedPanelNextSibling = panel.nextSibling;
            document.body.appendChild(panel);
          }
        } else {
          if (_speedPanelOriginalParent && panel.parentElement === document.body) {
            _speedPanelOriginalParent.insertBefore(panel, _speedPanelNextSibling);
            _speedPanelOriginalParent = null;
            _speedPanelNextSibling = null;
          }
        }
      }

      function toggleSpeedPanel() {
        speedPanelOpen = !speedPanelOpen;
        const panel = document.getElementById('speedPanel');
        const btn = document.getElementById('btnSettings');
        const isFullscreen = document.body.classList.contains('fullscreen-active');

        if (isFullscreen) {
          // Saat fullscreen: teleport panel ke body agar bebas dari stacking context backdrop-filter
          if (speedPanelOpen) {
            _teleportSpeedPanel(true);
            panel.classList.add('open');
          } else {
            panel.classList.remove('open');
            // Kembalikan setelah animasi selesai
            setTimeout(() => _teleportSpeedPanel(false), 350);
          }
        } else {
          // Di luar fullscreen: pastikan panel di posisi aslinya
          _teleportSpeedPanel(false);
          panel.classList.toggle('open', speedPanelOpen);
        }
        btn.classList.toggle('active', speedPanelOpen);
      }

      function setSpeed(speed) {
        currentSpeed = speed;
        applySpeed(speed);
        const slider = document.getElementById('speedSlider');
        slider.value = speed;
        updateSpeedUI(speed);
      }

      function updateSpeedUI(speed) {
        document.getElementById('speedBadge').textContent =
          speed.toFixed(2).replace(/\.?0+$/, '') + '×';
        const min = 0.25,
          max = 3.0;
        const pct = ((speed - min) / (max - min)) * 100;
        document.getElementById('speedTrackFill').style.width = pct + '%';
        const pitchVal = document.getElementById('pitchVal');
        if (speed === 1.0) {
          pitchVal.textContent = 'Normal';
          pitchVal.classList.remove('shifted');
        } else if (speed < 1.0) {
          const semitones = Math.round(12 * Math.log2(speed));
          pitchVal.textContent = `${semitones} semitone`;
          pitchVal.classList.add('shifted');
        } else {
          const semitones = Math.round(12 * Math.log2(speed));
          pitchVal.textContent = `+${semitones} semitone`;
          pitchVal.classList.add('shifted');
        }
        document.querySelectorAll('.speed-preset').forEach(btn => {
          const val = parseFloat(btn.textContent);
          btn.classList.toggle('active', Math.abs(val - speed) < 0.01);
        });
      }

      document.getElementById('speedSlider').addEventListener('input', e => {
        const speed = parseFloat(e.target.value);
        setSpeed(speed);
      });

      document.addEventListener('click', e => {
        if (!speedPanelOpen) return;
        const panel = document.getElementById('speedPanel');
        const btn = document.getElementById('btnSettings');
        if (!panel.contains(e.target) && !btn.contains(e.target)) {
          speedPanelOpen = false;
          panel.classList.remove('open');
          btn.classList.remove('active');
        }
      });

      updateSpeedUI(1.0);

      async function addFiles(files) {
        for (const f of files) {
          if (
            f.type.startsWith('audio/') ||
            /\.(mp3|wav|ogg|flac|m4a|aac|m4b)$/i.test(f.name) ||
            f.size > 102400
          ) {
            const coverUrl = await getCover(f);
            const tags = await getId3Tags(f);
            const meta = parseTrackMeta(f.name, tags);
            tracks.push({
              file: f,
              title: meta.title,
              artist: meta.artist,
              coverUrl,
              blobUrl: URL.createObjectURL(f),
              duration: '—:——'
            });
          }
        }
        renderTracks();
        document.getElementById('trackSection').style.display = 'block';
        if (curIdx < 0 && tracks.length > 0) loadTrack(0);
        if (tracks.length > 0) {
          setTimeout(scrollToPlayerSection, 50);
        }
        tracks.forEach((t, i) => {
          if (t.duration !== '—:——') return;
          const a = new Audio();
          a.src = t.blobUrl;
          a.addEventListener('loadedmetadata', () => {
            tracks[i].duration = fmt(a.duration);
            const el = document.querySelectorAll('.track-item')[i];
            if (el)
              el.querySelector('.track-dur').textContent = tracks[i].duration;
          });
        });
      }

      const dz = document.getElementById('dropZone');
      const fi = document.getElementById('fileInput');
      dz.addEventListener('dragover', e => {
        e.preventDefault();
        dz.classList.add('dragover');
      });
      dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('dragover');
        addFiles([...e.dataTransfer.files]);
      });
      fi.addEventListener('change', e => addFiles([...e.target.files]));

      function loadTrack(idx) {
        if (idx < 0 || idx >= tracks.length) return;
        const t = tracks[(curIdx = idx)];
        endFadeOutTriggered = false; // Reset trigger for the new song

        document.getElementById('npTitle').textContent = t.title;
        updateTitleMarquee();
        document.getElementById('npArtist').textContent = t.artist;
        document.getElementById('timeCur').textContent = '0:00';
        document.getElementById('timeTotal').textContent = t.duration;

        const img = document.getElementById('coverImg');
        const ph = document.getElementById('coverPh');
        if (t.coverUrl) {
          img.src = t.coverUrl;
          img.classList.add('on');
          ph.classList.add('off');
          img.onload = () => setAmbient(img);
        } else {
          img.classList.remove('on');
          ph.classList.remove('off');
          resetBackground();
          ['amb1', 'amb2', 'amb3'].forEach(id => {
            document.getElementById(id).classList.add('on');
          });
        }

        audio.src = t.blobUrl;

        const vol = parseFloat(document.getElementById('volSlider').value);
        audio.volume = fadeInEnabled ? 0 : vol; // Start at 0 for fade-in, or full volume if disabled
        updateVolumeIcons(vol);
        initAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        // Ekstraksi waveform secara asinkronus jika belum ada
        if (!t.waveform) {
          t.waveform = 'loading';
          generateWaveform(t.file).then(wave => {
            t.waveform = wave;
            if (curIdx === idx) {
              resizeCv();
            }
          });
        }

        audio.play().then(() => {
          applySpeed(currentSpeed);
          fadeVolume(vol, fadeInEnabled ? fadeInTime : 0); // Fade in to target volume
        }).catch(e => console.log("Play failed:", e));
        
        playing = true;
        syncBtn();
        document.getElementById('playerSection').classList.add('visible');
        document.body.classList.add('has-player');
        document.getElementById('playerCard').classList.add('playing');
        document.getElementById('btnPlay').classList.add('pulsing');
        cancelAnimationFrame(raf);
        raf = null;
        resizeCv();
        raf = requestAnimationFrame(draw);
        renderTracks();
      }

      function togglePlay() {
        if (curIdx < 0) {
          if (tracks.length > 0) playTrackWithFade(0);
          return;
        }
        if (playing) {
          pauseWithFade();
        } else {
          playWithFade();
        }
      }

      function prevTrack() {
        playTrackWithFade(curIdx <= 0 ? tracks.length - 1 : curIdx - 1);
      }
      function nextTrack() {
        playTrackWithFade((curIdx + 1) % tracks.length);
      }

      function syncBtn() {
        document.getElementById('iPlay').style.display = playing
          ? 'none'
          : 'block';
        document.getElementById('iPause').style.display = playing
          ? 'block'
          : 'none';
      }

      audio.addEventListener('timeupdate', () => {
        document.getElementById('timeCur').textContent = fmt(
          audio.currentTime
        );
        if (audio.duration) {
          document.getElementById('timeTotal').textContent = fmt(
            audio.duration
          );

          // Check if song is approaching its end and fade out has not been triggered yet
          const timeLeft = audio.duration - audio.currentTime;
          if (playing && fadeOutEnabled && fadeOutTime > 0 && timeLeft <= fadeOutTime && !endFadeOutTriggered) {
            endFadeOutTriggered = true;
            fadeVolume(0, fadeOutTime, () => {
              if (playing) {
                nextTrack();
              }
            });
          }
        }
      });
      audio.addEventListener('loadedmetadata', () => {
        document.getElementById('timeTotal').textContent = fmt(audio.duration);
        if (tracks[curIdx]) tracks[curIdx].duration = fmt(audio.duration);
      });
      audio.addEventListener('ended', () => nextTrack());
      audio.addEventListener('play', () => {
        if (!raf) raf = requestAnimationFrame(draw);
        audio.preservesPitch = false;
        audio.mozPreservesPitch = false;
        audio.webkitPreservesPitch = false;
      });
      audio.addEventListener('seeked', () => {
        if (playing && !raf) raf = requestAnimationFrame(draw);

        // Reset the end-of-song fade trigger if we seeked back before the fade threshold
        if (audio.duration && (audio.duration - audio.currentTime > fadeOutTime)) {
          endFadeOutTriggered = false;
          fadeVolume(getTargetVolume(), fadeInEnabled ? 0.3 : 0); // Quick fade-in of 0.3s for smooth recovery (if enabled)
        }
      });

      const updateVolumeIcons = v => {
        const volMute = document.getElementById('volMute');
        const volLow = document.getElementById('volLow');
        if (v === 0) {
          volMute.style.display = 'block';
          volLow.style.display = 'none';
        } else {
          volMute.style.display = 'none';
          volLow.style.display = 'block';
        }
      };
      const updateVolume = e => {
        if (activeFadeInterval) {
          clearInterval(activeFadeInterval);
          activeFadeInterval = null;
        }
        const v = parseFloat(e.target.value);
        audio.volume = v;
        updateVolumeIcons(v);
      };

      document.getElementById('volSlider').addEventListener('input', updateVolume);
      document.getElementById('volSlider').addEventListener('change', updateVolume);
      updateVolumeIcons(
        parseFloat(document.getElementById('volSlider').value) || 0.8
      );



      function delTrack(idx, e) {
        if (e) e.stopPropagation();
        URL.revokeObjectURL(tracks[idx].blobUrl);
        if (tracks[idx].coverUrl) URL.revokeObjectURL(tracks[idx].coverUrl);
        const wasPlaying = idx === curIdx;
        tracks.splice(idx, 1);
        if (wasPlaying) {
          audio.pause();
          playing = false;
          syncBtn();
          cancelAnimationFrame(raf);
          if (tracks.length > 0) {
            curIdx = Math.min(idx, tracks.length - 1);
            loadTrack(curIdx);
          } else {
            curIdx = -1;
            document.getElementById('playerSection').classList.remove('visible');
            document.body.classList.remove('has-player');
          }
        } else if (idx < curIdx) curIdx--;
        renderTracks();
        if (!tracks.length)
          document.getElementById('trackSection').style.display = 'none';
      }

      function renderTracks() {
        const list = document.getElementById('trackList');
        list.innerHTML = '';
        document.getElementById('trackCount').textContent =
          tracks.length + ' lagu';
        tracks.forEach((t, i) => {
          const active = i === curIdx;
          const div = document.createElement('div');
          div.className =
            'track-item' + (active ? ' active' + (playing ? ' playing' : '') : '');
          div.innerHTML = `
            <div class="track-num">${i + 1}</div>
            <div class="track-play-ind"><ion-icon name="play"></ion-icon></div>
            <div class="track-vis"><div class="tv-bar"></div><div class="tv-bar"></div><div class="tv-bar"></div><div class="tv-bar"></div></div>
            <div class="track-cover">
              ${t.coverUrl ? `<img src="${t.coverUrl}" class="on" alt="">` : ''}
              <ion-icon name="musical-notes"></ion-icon>
            </div>
            <div class="track-meta">
              <div class="track-name">${t.title}</div>
              <div class="track-artist">${t.artist}</div>
            </div>
            <div class="track-dur">${t.duration}</div>
            <button class="track-del" title="Hapus" onclick="delTrack(${i},event)"><ion-icon name="trash-outline"></ion-icon></button>
          `;
          div.addEventListener('click', e => {
            if (e.target.closest('.track-del')) return;
            if (curIdx === i) togglePlay();
            else playTrackWithFade(i);
          });
          list.appendChild(div);
        });
      }

      let toastT;
      function toast(msg) {
        const n = document.getElementById('toast');
        document.getElementById('toastMsg').textContent = msg;
        n.classList.add('show');
        clearTimeout(toastT);
        toastT = setTimeout(() => n.classList.remove('show'), 3000);
      }

      function focusElement(id) {
        if (curIdx < 0) return;
        const el = document.getElementById(id);
        if (el) {
          el.focus();
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }

      function toggleFullscreen() {
        isFullscreen = !isFullscreen;
        const body = document.body;
        const fsIcon = document.getElementById('fsIcon');
        
        if (isFullscreen) {
          body.classList.add('fullscreen-active');
          body.classList.add(`orient-${currentOrientation}`);
          if (fsIcon) fsIcon.setAttribute('name', 'contract-outline');
          
          // HTML5 Fullscreen API
          const docEl = document.documentElement;
          if (docEl.requestFullscreen) {
            docEl.requestFullscreen().then(() => {
              // Lock mobile screen orientation to current selection if supported
              if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock(currentOrientation).catch(() => {});
              }
            }).catch(err => {
              console.log("Browser fullscreen blocked/unsupported, using overlay fallback");
            });
          } else if (docEl.webkitRequestFullscreen) {
            docEl.webkitRequestFullscreen();
          } else if (docEl.msRequestFullscreen) {
            docEl.msRequestFullscreen();
          }
        } else {
          body.classList.remove('fullscreen-active');
          body.classList.remove('orient-portrait', 'orient-landscape');
          if (fsIcon) fsIcon.setAttribute('name', 'scan-outline');

          // Tutup & kembalikan speed panel ke posisi aslinya
          const panel = document.getElementById('speedPanel');
          if (panel) panel.classList.remove('open');
          speedPanelOpen = false;
          const btn = document.getElementById('btnSettings');
          if (btn) btn.classList.remove('active');
          setTimeout(() => _teleportSpeedPanel(false), 350);

          // Unlock mobile screen orientation
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }

          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
          }
        }
        
        setTimeout(() => {
          resizeCv();
          if (!raf && playing) {
            raf = requestAnimationFrame(draw);
          }
        }, 150);
      }

      document.addEventListener('fullscreenchange', () => {
        const nativeFS = !!document.fullscreenElement;
        if (!nativeFS && isFullscreen) {
          isFullscreen = false;
          document.body.classList.remove('fullscreen-active');
          document.body.classList.remove('orient-portrait', 'orient-landscape');
          const fsIcon = document.getElementById('fsIcon');
          if (fsIcon) fsIcon.setAttribute('name', 'scan-outline');
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
          setTimeout(() => {
            resizeCv();
          }, 150);
        }
      });

      document.addEventListener('webkitfullscreenchange', () => {
        const nativeFS = !!document.webkitFullscreenElement;
        if (!nativeFS && isFullscreen) {
          isFullscreen = false;
          document.body.classList.remove('fullscreen-active');
          document.body.classList.remove('orient-portrait', 'orient-landscape');
          const fsIcon = document.getElementById('fsIcon');
          if (fsIcon) fsIcon.setAttribute('name', 'scan-outline');
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
          setTimeout(() => {
            resizeCv();
          }, 150);
        }
      });

      function setOrientation(mode) {
        currentOrientation = mode;
        const btnPortrait = document.getElementById('btnOrientPortrait');
        const btnLandscape = document.getElementById('btnOrientLandscape');
        
        if (mode === 'portrait') {
          btnPortrait.classList.add('active');
          btnLandscape.classList.remove('active');
          if (isFullscreen) {
            document.body.classList.add('orient-portrait');
            document.body.classList.remove('orient-landscape');
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock('portrait').catch(() => {});
            }
          }
        } else {
          btnLandscape.classList.add('active');
          btnPortrait.classList.remove('active');
          if (isFullscreen) {
            document.body.classList.add('orient-landscape');
            document.body.classList.remove('orient-portrait');
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock('landscape').catch(() => {});
            }
          }
        }
        
        toast(`Orientasi: ${mode === 'portrait' ? 'Portrait' : 'Landscape'}`);
        
        setTimeout(() => {
          resizeCv();
        }, 150);
      }

      const titleEditor = document.getElementById('npTitle');
      const artistEditor = document.getElementById('npArtist');

      titleEditor.addEventListener('focus', () => {
        if (curIdx < 0) return;
        titleEditor.textContent = tracks[curIdx].title;
      });

      titleEditor.addEventListener('blur', () => {
        if (curIdx < 0) return;
        tracks[curIdx].title = titleEditor.innerText.trim() || 'Untitled';
        titleEditor.scrollLeft = 0;
        renderTracks();
        updateTitleMarquee();
      });

      artistEditor.addEventListener('focus', () => {
        if (curIdx < 0) return;
        artistEditor.textContent = tracks[curIdx].artist;
      });

      artistEditor.addEventListener('blur', () => {
        if (curIdx < 0) return;
        tracks[curIdx].artist =
          artistEditor.innerText.trim() || 'Unknown Artist';
        artistEditor.scrollLeft = 0;
        renderTracks();
      });

      document.getElementById('coverWrap').addEventListener('click', () => {
        if (curIdx < 0) return;
        document.getElementById('coverPicker').click();
      });

      document.getElementById('coverPicker').addEventListener('change', e => {
        if (curIdx < 0) return;
        const file = e.target.files[0];
        if (!file) return;

        const url = URL.createObjectURL(file);
        tracks[curIdx].coverUrl = url;

        const img = document.getElementById('coverImg');
        img.src = url;
        img.classList.add('on');

        document.getElementById('coverPh').classList.add('off');

        img.onload = () => {
          setAmbient(img);
        };

        renderTracks();
      });

      setTimeout(() => {
        resizeCv();
        draw();
      }, 150);



      /* ====== EXPORT VIDEO — Canvas Renderer (Pixel-accurate glass card design) ====== */
      const btnOpenExport     = document.getElementById('btnOpenExport');
      const exportModal       = document.getElementById('exportModal');
      const btnCancelExport   = document.getElementById('btnCancelExport');
      const btnStartExport    = document.getElementById('btnStartExport');
      const exportProgressWrap  = document.getElementById('exportProgressWrap');
      const exportProgressBar   = document.getElementById('exportProgressBar');
      const exportPercent       = document.getElementById('exportPercent');
      const exportStatusText    = document.getElementById('exportStatusText');

      btnOpenExport.addEventListener('click', () => {
        if (tracks.length === 0 || curIdx < 0) {
          showToast('Pilih lagu terlebih dahulu!');
          return;
        }
        document.getElementById('exportEnd').value = Math.floor(audio.duration || 30);
        exportModal.classList.add('open');
      });

      let isExporting        = false;
      let exportPollInterval = null;
      let exportRaf          = null;
      let mediaRecorder      = null;

      btnCancelExport.addEventListener('click', () => {
        if (isExporting) { stopExport(); return; }
        exportModal.classList.remove('open');
      });

      document.getElementById('btnCloseExportModal').addEventListener('click', () => {
        if (isExporting) stopExport();
        exportModal.classList.remove('open');
        resetExportUI();
      });

      function stopExport() {
        isExporting = false;
        if (exportPollInterval) clearInterval(exportPollInterval);
        if (exportRaf) cancelAnimationFrame(exportRaf);
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        resetExportUI();
      }

      /* ─── Helpers ──────────────────────────────────────────────────────── */
      function expRoundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
      }

      function drawExportWaveform(ctx, levels, waveData, vx, vy, vw, vh, prog) {
        const bars = 72, gap = 2;
        const bw   = (vw - gap * (bars - 1)) / bars;
        const filled = Math.floor(prog * bars);

        let buf = null;
        if (analyser && playing) {
          buf = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(buf);
        }
        const useLen = buf ? Math.floor(buf.length * 0.65) : 0;

        // Rounded pill container bg
        ctx.save();
        expRoundRect(ctx, vx, vy, vw, vh, vh / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fill();
        ctx.clip();  // bars clipped inside pill

        for (let i = 0; i < bars; i++) {
          const base   = waveData[i] * (vh - 8);
          let   target = 3;
          if (buf && playing) {
            const raw = buf[Math.floor((i * useLen) / bars)] / 255;
            target = Math.max(4, base * (0.4 + 0.8 * Math.pow(raw, 1.2)) + raw * 8);
          }
          levels[i] += (target - levels[i]) * 0.14;
          const h2     = Math.min(levels[i], vh * 0.92);
          const played = i < filled;

          if (played) {
            const g = ctx.createLinearGradient(0, vy + (vh - h2) / 2, 0, vy + (vh + h2) / 2);
            g.addColorStop(0, '#f5dfa8');
            g.addColorStop(1, '#c8a96e');
            ctx.fillStyle = g;
          } else {
            const a = 0.10 + (h2 / Math.max(1, vh - 4)) * 0.30;
            ctx.fillStyle = `rgba(200,169,110,${a})`;
          }
          expRoundRect(ctx, vx + (bw + gap) * i, vy + (vh - h2) / 2, bw, h2, 2);
          ctx.fill();
        }

        // Progress line
        const px = vx + prog * vw;
        const gl = ctx.createLinearGradient(px - 8, 0, px + 8, 0);
        gl.addColorStop(0,   'rgba(200,169,110,0)');
        gl.addColorStop(0.5, 'rgba(200,169,110,0.35)');
        gl.addColorStop(1,   'rgba(200,169,110,0)');
        ctx.fillStyle = gl;
        ctx.fillRect(px - 8, vy, 16, vh);
        ctx.beginPath();
        ctx.moveTo(px, vy);
        ctx.lineTo(px, vy + vh);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
      }

      function drawNowPlayingBadge(ctx, x, y, s) {
        const text    = '● NOW PLAYING';
        const fs      = Math.round(10 * s);
        ctx.font      = `700 ${fs}px 'Syne', 'Inter', sans-serif`;
        const tw      = ctx.measureText(text).width;
        const padX    = 14 * s, padY = 6 * s;
        const bw      = tw + padX * 2, bh = fs + padY * 2;

        ctx.save();
        expRoundRect(ctx, x, y, bw, bh, bh / 2);
        ctx.fillStyle = 'rgba(200,169,110,0.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,169,110,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle    = 'rgba(200,169,110,0.95)';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + padX, y + bh / 2);

        return bh;  // return badge height for layout
      }

      function drawExportControls(ctx, cx, cy, s, isPlaying) {
        // Three buttons centred around (cx, cy)
        const bigR   = 22 * s;   // play button radius
        const smR    = 18 * s;   // prev/next radius
        const gapBtn = 20 * s;

        // Centres
        const playX = cx;
        const prevX = cx - bigR - gapBtn - smR;
        const nextX = cx + bigR + gapBtn + smR;
        const bY    = cy;

        // Prev
        ctx.save();
        ctx.beginPath(); ctx.arc(prevX, bY, smR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.80)';
        const pis = smR * 0.40;
        ctx.beginPath();
        ctx.moveTo(prevX + pis * 0.2,  bY - pis);
        ctx.lineTo(prevX + pis * 0.2,  bY + pis);
        ctx.lineTo(prevX - pis * 0.95, bY);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(prevX - pis * 0.8,  bY - pis);
        ctx.lineTo(prevX - pis * 0.8,  bY + pis);
        ctx.lineTo(prevX - pis * 1.95, bY);
        ctx.closePath(); ctx.fill();

        // Play button (gold gradient circle)
        ctx.save();
        ctx.shadowColor = 'rgba(200,169,110,0.55)';
        ctx.shadowBlur  = 24 * s;
        ctx.beginPath(); ctx.arc(playX, bY, bigR, 0, Math.PI * 2);
        const pg = ctx.createLinearGradient(playX - bigR, bY - bigR, playX + bigR, bY + bigR);
        pg.addColorStop(0, '#f5dfa8');
        pg.addColorStop(1, '#c8a96e');
        ctx.fillStyle = pg; ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#1a1620';
        const is = bigR * 0.30;
        if (isPlaying) {
          // Pause bars
          ctx.fillRect(playX - is * 0.60, bY - is, is * 0.40, is * 2);
          ctx.fillRect(playX + is * 0.18, bY - is, is * 0.40, is * 2);
        } else {
          ctx.beginPath();
          ctx.moveTo(playX - is * 0.50, bY - is);
          ctx.lineTo(playX - is * 0.50, bY + is);
          ctx.lineTo(playX + is * 0.75, bY);
          ctx.closePath(); ctx.fill();
        }

        // Next
        ctx.save();
        ctx.beginPath(); ctx.arc(nextX, bY, smR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.80)';
        ctx.beginPath();
        ctx.moveTo(nextX - pis * 0.2,  bY - pis);
        ctx.lineTo(nextX - pis * 0.2,  bY + pis);
        ctx.lineTo(nextX + pis * 0.95, bY);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(nextX + pis * 0.8,  bY - pis);
        ctx.lineTo(nextX + pis * 0.8,  bY + pis);
        ctx.lineTo(nextX + pis * 1.95, bY);
        ctx.closePath(); ctx.fill();
      }

      function truncateText(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        while (text.length > 3 && ctx.measureText(text + '…').width > maxW) {
          text = text.slice(0, -1);
        }
        return text + '…';
      }

      /* ─── Main frame renderer ─────────────────────────────────────────── */
      function renderExportFrame(ec, W, H, isPortrait, s, coverImg, expLevels, waveData, fadeInSec, fadeOutSec, startT, duration) {
        const prog    = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
        const elapsed = Math.max(0, audio.currentTime - startT);

        const titleText  = (document.getElementById('npTitle').textContent || '').trim();
        const artistText = (document.getElementById('npArtist').textContent || '').trim();

        /* ── Background: blurred cover art ─── */
        ec.clearRect(0, 0, W, H);
        if (coverImg) {
          ec.save();
          ec.filter = 'blur(50px) saturate(160%) brightness(0.28)';
          const bs = Math.max(W / coverImg.width, H / coverImg.height) * 1.3;
          const bw = coverImg.width * bs, bh = coverImg.height * bs;
          ec.drawImage(coverImg, (W - bw) / 2, (H - bh) / 2, bw, bh);
          ec.filter = 'none';
          ec.restore();
        } else {
          const bg = ec.createLinearGradient(0, 0, W, H);
          bg.addColorStop(0, '#0d0b1e');
          bg.addColorStop(1, '#1c1830');
          ec.fillStyle = bg; ec.fillRect(0, 0, W, H);
        }
        // Dark overlay over blurred bg
        ec.fillStyle = 'rgba(0,0,0,0.52)';
        ec.fillRect(0, 0, W, H);

        if (isPortrait) {
          /* ══════════════════ PORTRAIT CARD ══════════════════ */
          const pad     = 18 * s;
          const cardW   = Math.min(340 * s, W * 0.88);
          const coverSz = cardW - pad * 2;

          // Estimate card height
          const badgeH   = (10 * s + 6 * s * 2);
          const titleH   = 20 * s * 1.3;
          const artistH  = 14 * s * 1.4;
          const visH     = 48 * s;
          const timeH    = 11 * s;
          const ctrlH    = 44 * s;
          const cardH    = pad + coverSz + 12 * s + badgeH + 14 * s + titleH + 6 * s + artistH + 18 * s + visH + 10 * s + timeH + 18 * s + ctrlH + pad;
          const cardX    = (W - cardW) / 2;
          const cardY    = (H - cardH) / 2;
          const rCard    = 28 * s;

          // Card shadow
          ec.save();
          ec.shadowColor   = 'rgba(0,0,0,0.75)';
          ec.shadowBlur    = 80 * s;
          ec.shadowOffsetY = 28 * s;
          expRoundRect(ec, cardX, cardY, cardW, cardH, rCard);
          ec.fillStyle = 'rgba(22,18,44,0.90)';
          ec.fill();
          ec.shadowBlur = 0; ec.shadowOffsetY = 0;
          ec.strokeStyle = 'rgba(255,255,255,0.16)';
          ec.lineWidth = 1; ec.stroke();
          ec.restore();

          // Top inset highlight
          ec.save();
          expRoundRect(ec, cardX, cardY, cardW, cardH, rCard);
          ec.clip();
          const hlg = ec.createLinearGradient(0, cardY, 0, cardY + 2 * s);
          hlg.addColorStop(0, 'rgba(255,255,255,0.12)');
          hlg.addColorStop(1, 'rgba(255,255,255,0)');
          ec.fillStyle = hlg; ec.fillRect(cardX, cardY, cardW, 2 * s);
          ec.restore();

          let cy = cardY + pad;

          // Cover art
          ec.save();
          ec.shadowColor = 'rgba(200,169,110,0.40)';
          ec.shadowBlur  = 28 * s;
          expRoundRect(ec, cardX + pad, cy, coverSz, coverSz, 18 * s);
          ec.clip();
          if (coverImg) {
            ec.drawImage(coverImg, cardX + pad, cy, coverSz, coverSz);
          } else {
            ec.fillStyle = '#1e1c3a'; ec.fill();
          }
          ec.restore();
          cy += coverSz + 14 * s;

          // Badge
          ec.font = `700 ${Math.round(10 * s)}px 'Syne','Inter',sans-serif`;
          const bh = drawNowPlayingBadge(ec, cardX + pad, cy, s);
          cy += bh + 14 * s;

          // Title
          const tfs = Math.round(20 * s);
          ec.font = `700 ${tfs}px 'Syne','Inter',sans-serif`;
          ec.fillStyle = '#ffffff';
          ec.textAlign = 'left'; ec.textBaseline = 'top';
          ec.fillText(truncateText(ec, titleText, cardW - pad * 2), cardX + pad, cy);
          cy += tfs * 1.3 + 6 * s;

          // Artist
          const afs = Math.round(14 * s);
          ec.font = `400 ${afs}px 'Syne','Inter',sans-serif`;
          ec.fillStyle = 'rgba(200,169,110,0.88)';
          ec.fillText(truncateText(ec, artistText, cardW - pad * 2), cardX + pad, cy);
          cy += afs * 1.4 + 18 * s;

          // Visualizer
          drawExportWaveform(ec, expLevels, waveData, cardX + pad, cy, cardW - pad * 2, visH, prog);
          cy += visH + 10 * s;

          // Time row
          const tms = Math.round(11 * s);
          ec.font = `400 ${tms}px 'DM Sans','Inter',sans-serif`;
          ec.fillStyle = 'rgba(255,255,255,0.45)';
          ec.textAlign = 'left';  ec.fillText(fmt(audio.currentTime), cardX + pad, cy);
          ec.textAlign = 'right'; ec.fillText(fmt(audio.duration || 0), cardX + cardW - pad, cy);
          cy += tms + 18 * s;

          // Controls
          drawExportControls(ec, cardX + cardW / 2, cy + ctrlH / 2, s, playing);

        } else {
          /* ══════════════════ LANDSCAPE CARD ══════════════════ */
          const pad      = 32 * s;
          const cardW    = Math.min(860 * s, W * 0.88);
          const coverSz  = 200 * s;
          const gapC     = 36 * s;  // gap between cover and info

          // Info panel dimensions
          const infoX = pad + coverSz + gapC;  // relative to cardX
          const infoW = cardW - infoX - pad;

          // Content rows
          const badgeH    = (10 * s + 6 * s * 2);
          const titleH    = 24 * s * 1.3;
          const artistH   = 15 * s * 1.4;
          const visH      = 60 * s;
          const timeH     = 12 * s;
          const ctrlH     = 44 * s;
          const infoContentH = badgeH + 14*s + titleH + 4*s + artistH + 18*s + visH + 8*s + timeH + 22*s + ctrlH;
          const cardH    = Math.max(coverSz + pad * 2, infoContentH + pad * 2);
          const cardX    = (W - cardW) / 2;
          const cardY    = (H - cardH) / 2;
          const rCard    = 32 * s;

          // Card shadow + glass bg
          ec.save();
          ec.shadowColor   = 'rgba(0,0,0,0.75)';
          ec.shadowBlur    = 80 * s;
          ec.shadowOffsetY = 28 * s;
          expRoundRect(ec, cardX, cardY, cardW, cardH, rCard);
          ec.fillStyle = 'rgba(14,12,32,0.93)';
          ec.fill();
          ec.shadowBlur = 0; ec.shadowOffsetY = 0;
          ec.strokeStyle = 'rgba(255,255,255,0.12)';
          ec.lineWidth = 1; ec.stroke();
          ec.restore();

          // Top inset highlight
          ec.save();
          expRoundRect(ec, cardX, cardY, cardW, cardH, rCard);
          ec.clip();
          const hlg2 = ec.createLinearGradient(0, cardY, 0, cardY + 2 * s);
          hlg2.addColorStop(0, 'rgba(255,255,255,0.10)');
          hlg2.addColorStop(1, 'rgba(255,255,255,0)');
          ec.fillStyle = hlg2; ec.fillRect(cardX, cardY, cardW, 2 * s);
          ec.restore();

          // ── Cover art ──
          const coverX = cardX + pad;
          const coverY = cardY + (cardH - coverSz) / 2;
          ec.save();
          ec.shadowColor = 'rgba(200,169,110,0.40)';
          ec.shadowBlur  = 30 * s;
          expRoundRect(ec, coverX, coverY, coverSz, coverSz, 20 * s);
          ec.clip();
          if (coverImg) {
            ec.drawImage(coverImg, coverX, coverY, coverSz, coverSz);
          } else {
            ec.fillStyle = '#1e1c3a'; ec.fill();
          }
          ec.restore();

          // ── Info panel ──
          const ix = cardX + infoX;
          let iy = cardY + pad;

          // Badge
          ec.font = `700 ${Math.round(10 * s)}px 'Syne','Inter',sans-serif`;
          const bh2 = drawNowPlayingBadge(ec, ix, iy, s);
          iy += bh2 + 14 * s;

          // Title
          const tfs2 = Math.round(24 * s);
          ec.font = `700 ${tfs2}px 'Syne','Inter',sans-serif`;
          ec.fillStyle = '#ffffff';
          ec.textAlign = 'left'; ec.textBaseline = 'top';
          ec.fillText(truncateText(ec, titleText, infoW), ix, iy);
          iy += tfs2 * 1.3 + 4 * s;

          // Artist
          const afs2 = Math.round(15 * s);
          ec.font = `400 ${afs2}px 'Syne','Inter',sans-serif`;
          ec.fillStyle = 'rgba(200,169,110,0.88)';
          ec.fillText(truncateText(ec, artistText, infoW), ix, iy);
          iy += afs2 * 1.4 + 18 * s;

          // Visualizer
          drawExportWaveform(ec, expLevels, waveData, ix, iy, infoW, visH, prog);
          iy += visH + 8 * s;

          // Time row
          const tms2 = Math.round(12 * s);
          ec.font = `400 ${tms2}px 'DM Sans','Inter',sans-serif`;
          ec.fillStyle = 'rgba(255,255,255,0.45)';
          ec.textAlign = 'left';  ec.fillText(fmt(audio.currentTime), ix, iy);
          ec.textAlign = 'right'; ec.fillText(fmt(audio.duration || 0), ix + infoW, iy);
          iy += tms2 + 22 * s;

          // Controls
          drawExportControls(ec, ix + infoW / 2, iy + ctrlH / 2, s, playing);
        }

        /* ── Fade In / Fade Out overlay ── */
        let fadeAlpha = 0;
        if (fadeInSec > 0 && elapsed < fadeInSec) {
          fadeAlpha = 1 - elapsed / fadeInSec;
        } else if (fadeOutSec > 0 && elapsed > duration - fadeOutSec) {
          fadeAlpha = Math.min(1, (elapsed - (duration - fadeOutSec)) / fadeOutSec);
        }
        if (fadeAlpha > 0) {
          ec.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
          ec.fillRect(0, 0, W, H);
        }
      }

      /* ─── Export button handler ─────────────────────────────────────────── */
      btnStartExport.addEventListener('click', async () => {
        if (isExporting) return;

        const aspect     = document.getElementById('exportAspect').value;
        const resolution = document.getElementById('exportResolution').value;
        const fps        = parseInt(document.getElementById('exportFps').value) || 30;
        const startT     = parseFloat(document.getElementById('exportStart').value) || 0;
        const endT       = parseFloat(document.getElementById('exportEnd').value) || 0;
        const fadeInSec  = parseFloat(document.getElementById('exportFadeIn').value) || 0;
        const fadeOutSec = parseFloat(document.getElementById('exportFadeOut').value) || 0;
        const isPortrait = aspect === '9:16';

        if (endT <= startT) { showToast('End Time harus lebih besar dari Start Time!'); return; }

        isExporting = true;
        btnStartExport.disabled = true;
        btnStartExport.style.opacity = '0.5';
        btnCancelExport.innerText = 'Batal Export';
        exportProgressWrap.style.display = 'block';
        exportProgressBar.style.width = '0%';
        exportPercent.innerText = '0%';
        exportStatusText.innerText = 'Menyiapkan...';

        /* ── Resolusi output ── */
        const resMap    = { '480p': 480, '720p': 720, '1080p': 1080, '4k': 2160 };
        const shortSide = resMap[resolution] || 1080;
        const W = isPortrait ? shortSide : Math.round(shortSide * 16 / 9);
        const H = isPortrait ? Math.round(shortSide * 16 / 9) : shortSide;

        // Scale factor: semua ukuran didefinisikan pada resolusi 1080p
        // s=1 → 1080p, s=0.667 → 720p, dst.
        const s = shortSide / 1080;

        /* ── Offscreen canvas ── */
        const expCanvas = document.createElement('canvas');
        expCanvas.width = W; expCanvas.height = H;
        const ec = expCanvas.getContext('2d');

        /* ── Load cover image ── */
        const track = tracks[curIdx];
        let coverImg = null;
        if (track && track.coverUrl) {
          exportStatusText.innerText = 'Memuat cover art...';
          await new Promise(resolve => {
            const img = new Image();
            img.onload  = () => { coverImg = img; resolve(); };
            img.onerror = () => resolve();
            img.crossOrigin = 'anonymous';
            img.src = track.coverUrl;
          });
        }

        /* ── Audio setup ── */
        exportStatusText.innerText = 'Menyiapkan audio...';
        initAudio();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        const audioDest = audioCtx.createMediaStreamDestination();
        analyser.connect(audioDest);

        /* ── Combine canvas + audio streams ── */
        const canvasStream   = expCanvas.captureStream(fps);
        const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioDest.stream.getAudioTracks()
        ]);

        /* ── Best MIME type ── */
        const mimeTypes = [
          'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
          'video/mp4',
          'video/webm;codecs="vp9,opus"',
          'video/webm;codecs="vp8,opus"',
          'video/webm',
        ];
        const mimeType = mimeTypes.find(m => {
          try { return MediaRecorder.isTypeSupported(m); } catch(e) { return false; }
        }) || 'video/webm';
        const fileExt = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

        const chunks = [];
        try {
          mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType,
            videoBitsPerSecond: 8_000_000
          });
        } catch(e) {
          showToast('Browser tidak mendukung MediaRecorder!');
          analyser.disconnect(audioDest);
          resetExportUI();
          return;
        }
        mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

        /* ── Waveform state for export canvas ── */
        const expLevels  = new Array(72).fill(3);
        const wave       = (track && Array.isArray(track.waveform)) ? track.waveform : placeholderWaveform;
        const duration   = endT - startT;

        /* ── rAF-based frame renderer (smooth 30fps) ── */
        function doFrame() {
          if (!isExporting) return;

          renderExportFrame(ec, W, H, isPortrait, s, coverImg, expLevels, wave, fadeInSec, fadeOutSec, startT, duration);

          // Progress
          const elapsed = Math.max(0, audio.currentTime - startT);
          const pct     = Math.min(100, Math.round((elapsed / duration) * 100));
          exportProgressBar.style.width = `${pct}%`;
          exportPercent.innerText       = `${pct}%`;
          exportStatusText.innerText    = `Merekam... ${pct}%`;

          exportRaf = requestAnimationFrame(doFrame);
        }

        /* ── Selesai merekam → download ── */
        mediaRecorder.onstop = () => {
          analyser.disconnect(audioDest);
          if (!chunks.length) { resetExportUI(); return; }

          exportStatusText.innerText = 'Mengunduh video...';
          exportProgressBar.style.width = '100%';
          exportPercent.innerText = '100%';

          const blob = new Blob(chunks, { type: mimeType });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          const safeName = (track && track.file ? track.file.name.replace(/\.[^.]+$/, '') : 'export');
          a.href = url;
          a.download = `${safeName}_${aspect.replace(':', 'x')}_${resolution}.${fileExt}`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 15000);

          showToast('✅ Export Selesai!');
          setTimeout(() => { exportModal.classList.remove('open'); resetExportUI(); }, 1800);
        };

        /* ── Mulai! ── */
        exportStatusText.innerText = 'Memutar & merekam...';
        mediaRecorder.start(200);

        audio.currentTime = startT;
        audio.volume = fadeInSec > 0 ? 0 : getTargetVolume();
        playing = true;
        if (!raf) draw();
        audio.play().catch(e => console.warn('Export play err:', e));
        if (fadeInSec > 0) fadeVolume(getTargetVolume(), fadeInSec);

        doFrame();

        /* ── Poll untuk stop di endT ── */
        exportPollInterval = setInterval(() => {
          if (!isExporting) {
            clearInterval(exportPollInterval);
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            return;
          }
          if (audio.currentTime >= endT || audio.ended) {
            isExporting = false;
            clearInterval(exportPollInterval);
            cancelAnimationFrame(exportRaf);
            audio.pause();
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
          }
        }, 200);
      });

      function resetExportUI() {
        isExporting = false;
        if (exportPollInterval) clearInterval(exportPollInterval);
        if (exportRaf) cancelAnimationFrame(exportRaf);
        mediaRecorder = null;
        btnStartExport.disabled = false;
        btnStartExport.style.opacity = '1';
        btnCancelExport.innerText = 'Batal';
        exportProgressWrap.style.display = 'none';
        exportProgressBar.style.width = '0%';
        exportPercent.innerText = '0%';
        exportStatusText.innerText = 'Siap merekam...';
      }
