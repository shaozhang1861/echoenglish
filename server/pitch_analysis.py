#!/usr/bin/env python3
"""
Pitch (F0) analysis using autocorrelation-based detection.
Extracts pitch curves from audio files using scipy's signal processing.
Supports AIFF/WAV (via soundfile/scipy.io.wavfile).
"""

import sys
import math
import soundfile as sf
import numpy as np
from scipy import signal
from scipy.io import wavfile


def read_audio(filepath: str):
    """Read audio file, convert to mono float32 array, return (samples, samplerate)."""
    try:
        data, sr = sf.read(filepath)
    except Exception:
        # fallback to scipy wavfile
        sr, data = wavfile.read(filepath)
        data = data.astype(np.float32) / 32768.0

    # stereo -> mono
    if len(data.shape) > 1:
        data = data.mean(axis=1)
    return data.astype(np.float32), int(sr)


def bandpass_filter(audio, sr, low=80, high=500):
    """Apply bandpass filter to keep speech F0 range (80-500 Hz)."""
    nyq = sr / 2
    b, a = signal.butter(4, [low / nyq, high / nyq], btype='band')
    return signal.filtfilt(b, a, audio)


def autocorrelation_pitch(signal_chunk, sr):
    """
    Detect pitch (F0) from a short audio chunk using autocorrelation.
    Returns F0 in Hz, or None if unvoiced.
    """
    if len(signal_chunk) < 2:
        return None

    # Normalize
    s = signal_chunk - signal_chunk.mean()
    rms = math.sqrt(np.mean(s ** 2))
    if rms < 0.001:
        return None

    s = s / (rms * 4 + 1e-9)

    min_period = int(sr / 500)   # max F0 = 500 Hz
    max_period = int(sr / 80)    # min F0 = 80 Hz

    if len(s) < max_period * 2:
        return None

    # Autocorrelation
    corr = signal.correlate(s, s, mode='full')
    corr = corr[len(corr) // 2:]

    # Find best peak in valid lag range
    peak_idx = -1
    peak_val = -1
    for i in range(min_period, min(max_period, len(corr))):
        if corr[i] > peak_val:
            peak_val = corr[i]
            peak_idx = i

    if peak_idx <= 0:
        return None

    # Parabolic interpolation for sub-sample accuracy
    if peak_idx < len(corr) - 1 and peak_idx > 0:
        y_minus = corr[peak_idx - 1]
        y_0 = corr[peak_idx]
        y_plus = corr[peak_idx + 1]
        if y_minus + y_plus - 2 * y_0 != 0:
            delta = (y_minus - y_plus) / (2 * (y_minus + y_plus - 2 * y_0))
            refined_idx = peak_idx + delta
        else:
            refined_idx = peak_idx
    else:
        refined_idx = peak_idx

    f0 = sr / refined_idx
    # sanity check
    if 60 < f0 < 600:
        return float(f0)
    return None


def extract_pitch_curve(audio, sr, hop_size_s=0.01, window_size_s=0.04):
    """
    Extract pitch (F0) contour from full audio.
    Returns list of (time_seconds, f0_hz) for voiced frames.
    """
    window_size = int(window_size_s * sr)
    hop_size = int(hop_size_s * sr)

    pitch_curve = []
    n_frames = (len(audio) - window_size) // hop_size

    for i in range(n_frames):
        chunk = audio[i * hop_size:i * hop_size + window_size]
        f0 = autocorrelation_pitch(chunk, sr)
        time_s = (i * hop_size) / sr
        pitch_curve.append((time_s, f0))

    return pitch_curve


def extract_segment_pitch(audio, sr, start_s, end_s, hop_size_s=0.01, window_size_s=0.04):
    """Extract pitch curve for a specific time segment."""
    start_sample = max(0, int(start_s * sr))
    end_sample = min(len(audio), int(end_s * sr))
    segment = audio[start_sample:end_sample]

    window_size = int(window_size_s * sr)
    hop_size = int(hop_size_s * sr)

    pitch_curve = []
    n_frames = (len(segment) - window_size) // hop_size

    for i in range(n_frames):
        chunk = segment[i * hop_size:i * hop_size + window_size]
        f0 = autocorrelation_pitch(chunk, sr)
        time_s = start_s + (i * hop_size) / sr
        pitch_curve.append((time_s, f0))

    return pitch_curve


def dtw_align(seq1, seq2, cost_fn=lambda a, b: abs(a - b) if a is not None and b is not None else 1000):
    """
    Dynamic Time Warping to align two pitch sequences.
    seq1, seq2: lists of (time, f0_or_None)
    Returns DTW distance and aligned sequences.
    """
    # Filter to only voiced frames
    s1 = [(t, f) for t, f in seq1 if f is not None]
    s2 = [(t, f) for t, f in seq2 if f is not None]

    if len(s1) == 0 or len(s2) == 0:
        return float('inf'), [], []

    n, m = len(s1), len(s2)
    dtw_matrix = np.full((n + 1, m + 1), np.inf)
    dtw_matrix[0, 0] = 0

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = abs(s1[i - 1][1] - s2[j - 1][1])
            dtw_matrix[i, j] = cost + min(
                dtw_matrix[i - 1, j],     # insertion
                dtw_matrix[i, j - 1],     # deletion
                dtw_matrix[i - 1, j - 1]  # match
            )

    # Backtrack
    path = []
    i, j = n, m
    while i > 0 or j > 0:
        path.append((i - 1, j - 1))
        if i == 0:
            j -= 1
        elif j == 0:
            i -= 1
        else:
            candidates = [
                (dtw_matrix[i - 1, j - 1], i - 1, j - 1),
                (dtw_matrix[i - 1, j], i - 1, j),
                (dtw_matrix[i, j - 1], i, j - 1),
            ]
            _, i, j = min(candidates, key=lambda x: x[0])

    path.reverse()

    # Extract aligned F0 values
    aligned1, aligned2 = [], []
    for i_idx, j_idx in path:
        if 0 <= i_idx < len(s1):
            aligned1.append(s1[i_idx][1])
        if 0 <= j_idx < len(s2):
            aligned2.append(s2[j_idx][1])

    total_cost = dtw_matrix[n, m]
    avg_cost = total_cost / len(path) if len(path) > 0 else float('inf')

    return avg_cost, aligned1, aligned2


def pitch_stats(pitch_curve):
    """Compute summary statistics from a pitch curve."""
    values = [f for _, f in pitch_curve if f is not None]
    if not values:
        return {
            'mean': None,
            'min': None,
            'max': None,
            'range': None,
            'voiced_frames': 0,
            'total_frames': len(pitch_curve),
            'voicing_ratio': 0,
        }
    return {
        'mean': float(np.mean(values)),
        'min': float(np.min(values)),
        'max': float(np.max(values)),
        'range': float(np.max(values) - np.min(values)),
        'voiced_frames': len(values),
        'total_frames': len(pitch_curve),
        'voicing_ratio': len(values) / len(pitch_curve) if pitch_curve else 0,
    }


def analyze(audio_path, start_s, end_s):
    """Main entry: analyze a single audio file segment."""
    audio, sr = read_audio(audio_path)

    # Bandpass filter for cleaner pitch detection
    filtered = bandpass_filter(audio, sr)

    pitch_curve = extract_segment_pitch(filtered, sr, start_s, end_s)
    stats = pitch_stats(pitch_curve)

    return {
        'audio_path': audio_path,
        'duration': end_s - start_s,
        'pitch_curve': [(round(t, 3), round(f, 2) if f is not None else None) for t, f in pitch_curve],
        'stats': {k: (round(v, 2) if isinstance(v, float) else v) for k, v in stats.items()},
    }


if __name__ == '__main__':
    # Test: python3 pitch_analysis.py <audio_file> <start_s> <end_s>
    if len(sys.argv) >= 4:
        result = analyze(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("Usage: python3 pitch_analysis.py <audio_file> <start_s> <end_s>")