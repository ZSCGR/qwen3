import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";
import LightBulbIcon from "./components/icons/LightBulbIcon";

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "解方程 x^2 - 3x + 2 = 0",
  "莉莉的年龄是她儿子的三倍。15年后，她的年龄将是他年龄的两倍。她现在几岁？",
  "编写 Python 代码计算第 n 个斐波那契数。",
];

function App() {
  // Create a reference to the worker object.
  const worker = useRef(null);

  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Model loading and progress
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);

  // Inputs and outputs
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);
  const [reasonEnabled, setReasonEnabled] = useState(false);

  function onEnter(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");
  }

  function onInterrupt() {
    // NOTE: We do not set isRunning to false here because the worker
    // will send a 'complete' message when it is done.
    worker.current.postMessage({ type: "interrupt" });
  }

  useEffect(() => {
    resizeInput();
  }, [input]);

  function resizeInput() {
    if (!textareaRef.current) return;

    const target = textareaRef.current;
    target.style.height = "auto";
    const newHeight = Math.min(Math.max(target.scrollHeight, 24), 200);
    target.style.height = `${newHeight}px`;
  }

  // We use the `useEffect` hook to setup the worker as soon as the `App` component is mounted.
  useEffect(() => {
    // Create the worker if it does not yet exist.
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" }); // Do a feature check
    }

    // Create a callback function for messages from the worker thread.
    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "loading":
          // Model file start load: add a new progress item to the list.
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;

        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;

        case "progress":
          // Model file progress: update one of the progress items.
          setProgressItems((prev) =>
            prev.map((item) => {
              if (item.file === e.data.file) {
                return { ...item, ...e.data };
              }
              return item;
            }),
          );
          break;

        case "done":
          // Model file loaded: remove the progress item from the list.
          setProgressItems((prev) =>
            prev.filter((item) => item.file !== e.data.file),
          );
          break;

        case "ready":
          // Pipeline ready: the worker is ready to accept messages.
          setStatus("ready");
          break;

        case "start":
          {
            // Start generation
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "" },
            ]);
          }
          break;

        case "update":
          {
            // Generation update: update the output text.
            // Parse messages
            const { output, tps, numTokens, state } = e.data;
            setTps(tps);
            setNumTokens(numTokens);
            setMessages((prev) => {
              const cloned = [...prev];
              const last = cloned.at(-1);
              const data = {
                ...last,
                content: last.content + output,
              };
              if (data.answerIndex === undefined && state === "answering") {
                // When state changes to answering, we set the answerIndex
                data.answerIndex = last.content.length;
              }
              cloned[cloned.length - 1] = data;
              return cloned;
            });
          }
          break;

        case "complete":
          // Generation complete: re-enable the "Generate" button
          setIsRunning(false);
          break;

        case "error":
          setError(e.data.data);
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, []);

  // Send the messages to the worker thread whenever the `messages` state changes.
  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) {
      // No user messages yet: do nothing.
      return;
    }
    if (messages.at(-1).role === "assistant") {
      // Do not update if the last message is from the assistant
      return;
    }
    setTps(null);
    worker.current.postMessage({
      type: "generate",
      data: { messages, reasonEnabled },
    });
  }, [messages, isRunning, reasonEnabled]);

  useEffect(() => {
    if (!chatContainerRef.current || !isRunning) return;
    const element = chatContainerRef.current;
    if (
      element.scrollHeight - element.scrollTop - element.clientHeight <
      STICKY_SCROLL_THRESHOLD
    ) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, isRunning]);

  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      {status === null && messages.length === 0 && (
        <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
          <div className="flex flex-col items-center mb-1 max-w-[360px] text-center">
            <img
              src="logo.png"
              width="80%"
              height="auto"
              className="block drop-shadow-lg bg-transparent"
            ></img>
            <h1 className="text-4xl font-bold my-1">Qwen3 WebGPU 演示</h1>
            <h2 className="font-semibold">
              一个混合推理模型，在浏览器中本地运行，支持 WebGPU 加速。
            </h2>
          </div>

          <div className="flex flex-col items-center px-4">
            <p className="max-w-[480px] mb-4">
              <br />
              即将加载模型：{" "}
              <a
                href="https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                Qwen3-0.6B
              </a>
              ，这是一个为浏览器推理优化的 0.6B 参数推理模型。所有计算完全在浏览器中进行，基于{" "}
              <a
                href="https://huggingface.co/docs/transformers.js"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Transformers.js
              </a>
              和 ONNX Runtime Web，意味着不会向服务器发送数据。模型加载完成后甚至可以离线使用。演示源码托管于{" "}
              <a
                href="https://github.com/huggingface/transformers.js-examples/tree/main/qwen3-webgpu"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                GitHub
              </a>
              。
            </p>

            {error && (
              <div className="text-red-500 text-center mb-2">
                <p className="mb-1">模型加载失败，错误信息：</p>
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              className="border px-4 py-2 rounded-lg bg-blue-400 text-white hover:bg-blue-500 disabled:bg-blue-100 cursor-pointer disabled:cursor-not-allowed select-none"
              onClick={() => {
                worker.current.postMessage({ type: "load" });
                setStatus("loading");
              }}
              disabled={status !== null || error !== null}
            >
              加载模型
            </button>
          </div>
        </div>
      )}
      {status === "loading" && (
        <>
          <div className="w-full max-w-[500px] text-left mx-auto p-4 bottom-0 mt-auto">
            <p className="text-center mb-1">{loadingMessage}</p>
            {progressItems.map(({ file, progress, total }, i) => (
              <Progress
                key={i}
                text={file}
                percentage={progress}
                total={total}
              />
            ))}
          </div>
        </>
      )}

      {status === "ready" && (
        <div
          ref={chatContainerRef}
          className="overflow-y-auto scrollbar-thin w-full flex flex-col items-center h-full"
        >
          <Chat messages={messages} />
          {messages.length === 0 && (
            <div>
              {EXAMPLES.map((msg, i) => (
                <div
                  key={i}
                  className="m-1 border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer max-w-[500px]"
                  onClick={() => onEnter(msg)}
                >
                  {msg}
                </div>
              ))}
            </div>
          )}
            <p className="text-center text-sm min-h-6 text-gray-500 dark:text-gray-300">
            {tps && messages.length > 0 && (
              <>
                {!isRunning && (
                  <span>
                    生成 {numTokens} 个 token，用时{" "}
                    {(numTokens / tps).toFixed(2)} 秒&nbsp;&#40;
                  </span>
                )}
                {
                  <>
                    <span className="font-medium text-center mr-1 text-black dark:text-white">
                      {tps.toFixed(2)}
                    </span>
                    <span className="text-gray-500 dark:text-gray-300">
                      token/秒
                    </span>
                  </>
                }
                {!isRunning && (
                  <>
                    <span className="mr-1">&#41;.</span>
                    <span
                      className="underline cursor-pointer"
                      onClick={() => {
                        worker.current.postMessage({ type: "reset" });
                        setMessages([]);
                      }}
                    >
                      重置
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}

      <div className="w-[600px] max-w-[80%] mx-auto mt-2 mb-3">
        <div className="border border-gray-300 dark:border-gray-500 dark:bg-gray-700 rounded-lg max-h-[200px] relative flex">
          <textarea
            ref={textareaRef}
            className="scrollbar-thin w-[550px] px-3 py-4 rounded-lg bg-transparent border-none outline-hidden text-gray-800 disabled:text-gray-400 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-300 disabled:placeholder-gray-200 dark:disabled:placeholder-gray-500 resize-none disabled:cursor-not-allowed"
            placeholder="输入你的消息..."
            type="text"
            rows={1}
            value={input}
            disabled={status !== "ready"}
            title={status === "ready" ? "模型已准备好" : "模型未加载"}
            // onKeyDown={(e) => {
            //   if (
            //     input.length > 0 &&
            //     !isRunning &&
            //     e.key === "Enter" &&
            //     !e.shiftKey
            //   ) {
            //     e.preventDefault(); // Prevent default behavior of Enter key
            //     onEnter(input);
            //   }
            // }}
            onInput={(e) => setInput(e.target.value)}
          />
          {isRunning ? (
            <div className="cursor-pointer" onClick={onInterrupt}>
              <StopIcon className="h-8 w-8 p-1 rounded-md text-gray-800 dark:text-gray-100 absolute right-3 bottom-3" />
            </div>
          ) : input.length > 0 ? (
            <div className="cursor-pointer" onClick={() => onEnter(input)}>
              <ArrowRightIcon
                className={`h-8 w-8 p-1 bg-gray-800 dark:bg-gray-100 text-white dark:text-black rounded-md absolute right-3 bottom-3`}
              />
            </div>
          ) : (
            <div>
              <ArrowRightIcon
                className={`h-8 w-8 p-1 bg-gray-200 dark:bg-gray-600 text-gray-50 dark:text-gray-800 rounded-md absolute right-3 bottom-3`}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <div
            className={`border pointer-curson mt-1 inline-flex items-center p-2 gap-1 rounded-xl text-sm cursor-pointer ${
              reasonEnabled
                ? "border-blue-500 bg-blue-100 text-blue-500 dark:bg-blue-600 dark:text-gray-200"
                : "dark:border-gray-700 bg-gray-800 text-gray-200 dark:text-gray-400"
            }`}
            onClick={() => setReasonEnabled((prev) => !prev)}
          >
            <LightBulbIcon
              className={`h-4 w-4 ${
                reasonEnabled ? "" : "stroke-gray-600 dark:stroke-gray-400"
              }`}
            />
            推理过程
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center mb-3">
        免责声明：生成的内容可能不准确或包含错误。
      </p>
    </div>
  ) : (
    <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-semibold flex justify-center items-center text-center">
      此浏览器不支持 WebGPU
      <br />
      无法运行本演示 :&#40;
    </div>
  );
}

export default App;
