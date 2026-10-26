/** Upload box for the media library page: uploads, then reloads the page so the new file shows in the grid. */
import MediaUploader from './MediaUploader';

export default function LibraryUpload() {
  return <MediaUploader idPrefix="lib-up" onUploaded={() => setTimeout(() => location.reload(), 900)} />;
}
