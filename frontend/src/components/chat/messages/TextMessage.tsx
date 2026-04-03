"use client";

interface TextMessageProps {
  content: string;
  role: "user" | "assistant";
}

export default function TextMessage({ content, role }: TextMessageProps) {
  return (
    <div
      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
        role === "user"
          ? "ml-auto bg-primary/20 text-white"
          : "mr-auto bg-surface text-gray-200"
      }`}
    >
      <div className="whitespace-pre-wrap break-words leading-relaxed">
        {content}
      </div>
    </div>
  );
}
