Text detection model: put ONE of these files in this folder.

  comictextdetector-fp16.onnx   (preferred: half precision, faster on the GPU)
  comictextdetector.pt.onnx     (as published, full precision)

comictextdetector.pt.onnx is comic-text-detector by dmMaze
(https://github.com/dmMaze/comic-text-detector), exported to ONNX by
manga-image-translator (https://github.com/zyddnys/manga-image-translator):
  https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx
  (94,669,756 bytes, SHA-256 1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f)
It is the same file Tsundoku downloads on first use.

comictextdetector-fp16.onnx is that file converted to half precision (float16)
with onnxconverter-common:
  pip install onnx onnxconverter-common
  python -c "import onnx; from onnxconverter_common import float16; m = onnx.load('comictextdetector.pt.onnx'); onnx.save(float16.convert_float_to_float16(m, keep_io_types=True), 'comictextdetector-fp16.onnx')"

The model files are not kept in the Git repository (size, and they come under
their projects' license: GPL-3.0 at the time of writing).
