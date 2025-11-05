"""
Audio Transcription Streamlit App using OpenAI Whisper API
Web-based application with auto-save functionality
Handles files of any size with automatic chunking for files > 25MB
"""

import os
import sys
import subprocess
from pathlib import Path
import streamlit as st

try:
    from openai import OpenAI
    from pydub import AudioSegment
    from pydub.utils import make_chunks
    from dotenv import load_dotenv
except ImportError:
    st.error("Required packages not installed. Please run: pip install openai pydub python-dotenv streamlit")
    sys.exit(1)

# Load environment variables
load_dotenv()


def check_ffmpeg():
    """Check if FFmpeg is installed and accessible."""
    try:
        result = subprocess.run(['ffmpeg', '-version'], 
                              capture_output=True, 
                              text=True, 
                              timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    except Exception:
        return False


class AudioTranscriber:
    """Core transcription logic."""

    def __init__(self, api_key):
        self.client = OpenAI(api_key=api_key)
        self.max_file_size = 25 * 1024 * 1024  # 25 MB

    def get_file_size(self, file_path):
        return os.path.getsize(file_path)

    def load_audio(self, file_path):
        """Load audio file - will raise error if FFmpeg not found."""
        file_ext = Path(file_path).suffix.lower().replace('.', '')
        format_map = {
            'mp3': 'mp3', 'wav': 'wav', 'flac': 'flac',
            'm4a': 'mp4', 'ogg': 'ogg', 'wma': 'wma', 'aac': 'aac'
        }
        audio_format = format_map.get(file_ext, file_ext)

        try:
            audio = AudioSegment.from_file(file_path, format=audio_format)
            return audio, file_ext
        except FileNotFoundError as e:
            raise FileNotFoundError(
                "FFmpeg not found! Please install FFmpeg:\n\n"
                "Option 1 (Recommended for Anaconda users):\n"
                "  conda install -c conda-forge ffmpeg\n\n"
                "Option 2 (Manual installation):\n"
                "  Download from: https://ffmpeg.org/download.html"
            ) from e

    def split_audio_into_chunks(self, audio, chunk_size_mb=20):
        bitrate = audio.frame_rate * audio.frame_width * 8 * audio.channels
        chunk_size_bytes = chunk_size_mb * 1024 * 1024
        chunk_length_ms = int((chunk_size_bytes * 8 * 1000) / bitrate)
        chunks = make_chunks(audio, chunk_length_ms)
        return chunks

    def transcribe_file(self, file_path):
        with open(file_path, 'rb') as audio_file:
            transcript = self.client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text"
            )
        return transcript

    def transcribe_audio(self, audio_file_path, progress_callback=None):
        if progress_callback:
            progress_callback("Checking file size...")

        file_size = self.get_file_size(audio_file_path)

        if file_size < self.max_file_size:
            if progress_callback:
                progress_callback(f"File size: {file_size/(1024*1024):.2f} MB - Transcribing directly...")
            transcript = self.transcribe_file(audio_file_path)
        else:
            if progress_callback:
                progress_callback(f"File size: {file_size/(1024*1024):.2f} MB - Splitting into chunks...")
            transcript = self.transcribe_large_file(audio_file_path, progress_callback)

        return transcript

    def transcribe_large_file(self, audio_file_path, progress_callback=None):
        if progress_callback:
            progress_callback("Loading audio file...")

        audio, original_format = self.load_audio(audio_file_path)

        if progress_callback:
            progress_callback("Splitting audio into chunks...")

        chunks = self.split_audio_into_chunks(audio, chunk_size_mb=20)

        if progress_callback:
            progress_callback(f"Audio split into {len(chunks)} chunks")

        temp_dir = Path("temp_audio_chunks")
        temp_dir.mkdir(exist_ok=True)

        transcripts = []

        try:
            for i, chunk in enumerate(chunks):
                if progress_callback:
                    progress_callback(f"Processing chunk {i+1}/{len(chunks)}...")

                temp_file = temp_dir / f"chunk_{i}.mp3"
                chunk.export(temp_file, format="mp3")

                chunk_transcript = self.transcribe_file(str(temp_file))
                transcripts.append(chunk_transcript)

                temp_file.unlink()

                if progress_callback:
                    progress_callback(f"Chunk {i+1}/{len(chunks)} completed")

            if progress_callback:
                progress_callback("Merging transcripts...")

            full_transcript = " ".join(transcripts)

        finally:
            if temp_dir.exists():
                import shutil
                shutil.rmtree(temp_dir)

        return full_transcript


def get_default_transcript_path(audio_file_path):
    """Generate default transcript path based on audio file location."""
    audio_path = Path(audio_file_path)
    transcript_name = audio_path.stem + "_transcript.txt"
    return str(audio_path.parent / transcript_name)


def main():
    """Main Streamlit application."""

    # Page configuration
    st.set_page_config(
        page_title="Audio Transcription - Whisper",
        page_icon="🎙️",
        layout="wide"
    )

    # Title and description
    st.title("🎙️ Audio Transcription Tool")
    st.markdown("**Powered by OpenAI Whisper API**")
    st.markdown("---")

    # Check FFmpeg installation
    if not check_ffmpeg():
        st.error("""
        ⚠️ **FFmpeg Not Found!**

        FFmpeg is required to process audio files.

        **Installation Options:**
        - **Anaconda users:** `conda install -c conda-forge ffmpeg`
        - **Manual install:** Download from https://ffmpeg.org/download.html

        Please install FFmpeg and restart the application.
        """)

    # Sidebar for API key
    with st.sidebar:
        st.header("⚙️ Configuration")

        # API Key input
        env_key = os.getenv("OPENAI_API_KEY", "")
        api_key = st.text_input(
            "OpenAI API Key",
            value=env_key,
            type="password",
            help="Enter your OpenAI API key or set it in .env file"
        )

        if not api_key:
            st.warning("Please enter your API key to continue")
            st.info("Get your API key from: https://platform.openai.com/api-keys")

        st.markdown("---")

        # Auto-save option
        auto_save = st.checkbox(
            "Auto-save transcript",
            value=True,
            help="Automatically save transcript to audio file folder with _transcript suffix"
        )

        st.markdown("---")
        st.markdown("### 📝 Supported Formats")
        st.markdown("""
        - MP3
        - WAV
        - FLAC
        - M4A
        - OGG
        - AAC
        - WMA
        """)

        st.markdown("---")
        st.markdown("### 💡 Features")
        st.markdown("""
        - ✅ Handles large files (auto-chunks > 25MB)
        - ✅ Auto-save to file folder
        - ✅ Download transcript
        - ✅ Copy to clipboard
        """)

    # Main content area
    col1, col2 = st.columns([2, 3])

    with col1:
        st.subheader("📁 Upload Audio File")
        uploaded_file = st.file_uploader(
            "Choose an audio file",
            type=['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'wma'],
            help="Select an audio file to transcribe"
        )

        if uploaded_file:
            st.success(f"✅ File loaded: {uploaded_file.name}")
            st.info(f"📊 File size: {uploaded_file.size / (1024*1024):.2f} MB")

    with col2:
        st.subheader("🚀 Transcription")

        if st.button("Start Transcription", type="primary", disabled=not (api_key and uploaded_file)):
            if not api_key:
                st.error("Please enter your OpenAI API key")
            elif not uploaded_file:
                st.error("Please upload an audio file")
            else:
                # Save uploaded file temporarily
                temp_audio_path = f"temp_{uploaded_file.name}"
                with open(temp_audio_path, "wb") as f:
                    f.write(uploaded_file.getbuffer())

                try:
                    # Initialize transcriber
                    transcriber = AudioTranscriber(api_key)

                    # Progress container
                    progress_placeholder = st.empty()
                    status_placeholder = st.empty()

                    def update_progress(message):
                        status_placeholder.info(message)

                    # Transcribe
                    with st.spinner("Transcribing..."):
                        transcript = transcriber.transcribe_audio(
                            temp_audio_path,
                            progress_callback=update_progress
                        )

                    # Store transcript in session state
                    st.session_state['transcript'] = transcript
                    st.session_state['audio_filename'] = uploaded_file.name

                    # Auto-save if enabled
                    if auto_save:
                        default_path = get_default_transcript_path(temp_audio_path)
                        # For Streamlit, save in current directory instead
                        save_path = Path(uploaded_file.name).stem + "_transcript.txt"
                        try:
                            with open(save_path, 'w', encoding='utf-8') as f:
                                f.write(transcript)
                            status_placeholder.success(f"✅ Transcription completed! Auto-saved to: {save_path}")
                        except Exception as e:
                            status_placeholder.warning(f"⚠️ Transcription completed but auto-save failed: {str(e)}")
                    else:
                        status_placeholder.success("✅ Transcription completed successfully!")

                except Exception as e:
                    st.error(f"❌ Transcription failed: {str(e)}")

                finally:
                    # Clean up temporary file
                    if os.path.exists(temp_audio_path):
                        os.remove(temp_audio_path)

    # Display transcript if available
    if 'transcript' in st.session_state:
        st.markdown("---")
        st.subheader("📄 Transcript")

        # Display transcript in text area
        transcript = st.text_area(
            "Transcript content:",
            value=st.session_state['transcript'],
            height=300,
            key="transcript_display"
        )

        # Action buttons
        col1, col2, col3 = st.columns([1, 1, 3])

        with col1:
            # Download button
            st.download_button(
                label="💾 Download Transcript",
                data=st.session_state['transcript'],
                file_name=Path(st.session_state['audio_filename']).stem + "_transcript.txt",
                mime="text/plain"
            )

        with col2:
            # Copy button (using clipboard)
            if st.button("📋 Copy to Clipboard"):
                st.info("Select and copy the text from the text area above")

        with col3:
            if st.button("🗑️ Clear"):
                if 'transcript' in st.session_state:
                    del st.session_state['transcript']
                if 'audio_filename' in st.session_state:
                    del st.session_state['audio_filename']
                st.rerun()

    # Footer
    st.markdown("---")
    st.markdown("""
    <div style='text-align: center; color: gray;'>
        <p>Built with Streamlit • Powered by OpenAI Whisper API</p>
        <p>Cost: $0.006 per minute of audio</p>
    </div>
    """, unsafe_allow_html=True)


if __name__ == "__main__":
    main()
