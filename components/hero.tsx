// prompt-rewriter/components/hero.tsx
export function Hero() {
  return (
    <section className="mx-auto max-w-[720px] px-6 pb-10 pt-12 text-left">
      <h1 className="text-left font-serif text-[34px] font-semibold leading-[1.25] tracking-tight text-near-black">
        把用户随手写的一句话,改写成生图模型真正认得的 prompt
      </h1>
      <p className="mt-3 text-left text-[16px] leading-[1.6] text-olive-gray">
        识别需求 → 拆字段 → 调行业知识 → 挂硬约束 → 补增益 → 合成 prompt → 直接出图验证。
        整条改写链路完全可见、可调、可评审。
      </p>
    </section>
  );
}
