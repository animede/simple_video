import os
import openai
from   openai import OpenAI
from   openai import AsyncOpenAI
import asyncio

# ローカル LLM モジュール（--local-llm 時のみ利用）
try:
    import local_llm as _local_llm_mod
except ImportError:
    _local_llm_mod = None  # type: ignore[assignment]

# OpenAI APIから応答を取得する関数 ログなし（非同期版）
async def chat_req(
    client,
    user_msg,
    role,
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    repeat_penalty: float | None = None,
):
    # ローカル LLM がロード済みなら直接呼び出す（client は使わない）
    if _local_llm_mod is not None and _local_llm_mod.is_loaded():
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: _local_llm_mod.chat_completion(
                user_msg=user_msg,
                role=role,
                max_tokens=max_tokens,
                temperature=temperature,
                repeat_penalty=repeat_penalty,
            ),
        )

    messages = [
        {"role": "system", "content": role},
        {"role": "user", "content": user_msg}
    ]
    # await を使って coroutine の実行結果を取得
    effective_model = (model or os.environ.get("OPENAI_CHAT_MODEL") or "gemma3:latest")
    kwargs = {}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if temperature is not None:
        kwargs["temperature"] = temperature
    # repeat_penalty: llama.cpp と Ollama 両方でサポート
    # extra_body 経由で渡すことで未対応バックエンドでも 400 にならない
    if repeat_penalty is not None:
        kwargs["extra_body"] = {"repeat_penalty": repeat_penalty}

    completion = await client.chat.completions.create(
        model=effective_model,
        messages=messages,
        **kwargs,
    )
    return completion.choices[0].message.content


# VLM（Vision Language Model）用の関数 - 画像付きチャット（非同期版）
async def vlm_req(client, user_msg, image_base64, role="You are a helpful assistant.", model="gemma-3-27b-it", max_tokens=1024, temperature=0.3):
    """
    画像付きのチャットリクエストを送信する
    
    Args:
        client: AsyncOpenAI client
        user_msg: ユーザーのテキスト入力
        image_base64: Base64エンコードされた画像（"data:image/jpeg;base64,..." 形式）
        role: システムロール
        model: 使用するモデル名
        max_tokens: 最大トークン数
        temperature: 温度パラメータ
    
    Returns:
        str: モデルの応答テキスト
    """
    messages = [
        {"role": "system", "content": role},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_msg},
                {"type": "image_url", "image_url": {"url": image_base64}}
            ]
        }
    ]
    
    completion = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return completion.choices[0].message.content


# VLM（Vision Language Model）用の関数 - 複数画像対応（非同期版）
async def vlm_req_multi_images(client, user_msg, images_base64, role="You are a helpful assistant.", model="gemma-3-27b-it", max_tokens=1024, temperature=0.3):
    """
    複数画像付きのチャットリクエストを送信する
    
    Args:
        client: AsyncOpenAI client
        user_msg: ユーザーのテキスト入力
        images_base64: Base64エンコードされた画像のリスト
        role: システムロール
        model: 使用するモデル名
        max_tokens: 最大トークン数
        temperature: 温度パラメータ
    
    Returns:
        str: モデルの応答テキスト
    """
    content = [{"type": "text", "text": user_msg}]
    for img in images_base64:
        content.append({"type": "image_url", "image_url": {"url": img}})
    
    messages = [
        {"role": "system", "content": role},
        {"role": "user", "content": content}
    ]
    
    completion = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return completion.choices[0].message.content

# OpenAI APIから応答を取得する関数
def chat_conversation(client,user_msg,role,conversation_logs,max_logs):
    # ステップ1: ユーザー入力と関数の定義を GPT に送る
    messages = [{"role": "system", "content": role}] + conversation_logs + [{"role": "user", "content": user_msg}]
    completion = client.chat.completions.create(
        model="gemma2:latest",
        messages=messages,
        #stream=True,
    )
    out1=completion.choices[0].message.content
    print("put1=",out1)
    conversation_logs.append({"role": "user", "content": user_msg})
    conversation_logs.append({"role": "assistant", "content": out1})
    # 会話ログが最大数を超えた場合、古いログを削除
    if len(conversation_logs) > max_logs:
            conversation_logs = conversation_logs[-max_logs:]
    return  out1,conversation_logs

# OpenAI APIから応答を取得する非同期ジェネレーター関数
#async def chat_with_openai_stream(a_client, user_message,role, conversation_logs, max_logs):
async def chat_with_openai_stream(a_client, user_message,role, conversation_logs):
    try:
        # 会話履歴にroleとユーザーメッセージを追加
        messages = [{"role": "system", "content": role}] + conversation_logs + [{"role": "user", "content": user_message}]
        #messages = [{"role": "system", "content": "Reasoning: low"+role+"、必ず日本語で答える"}] + conversation_logs + [{"role": "user", "content": user_message}]
        # デバッグ用のメッセージ出力
        #print(f"Sending to API: {messages}")
        # ストリーミングリクエストを実行
        stream = await a_client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            #extra_body={"chat_template_kwargs":{"reasoning_effort": "low"}},
            stream=True,
        )
        response_sum = ""
        # ストリーミングで応答を処理
        async for chunk in stream:
            response_chunk = chunk.choices[0].delta.content or ""
            response_sum += response_chunk
            #print(response_sum)
            yield response_chunk  # 部分的な応答をストリーミング
        '''    
        # 全体の応答を保存
        conversation_logs.append({"role": "user", "content": user_message})
        conversation_logs.append({"role": "assistant", "content": response_sum})
        # 会話ログが最大数を超えた場合、古いログを削除
        if len(conversation_logs) > max_logs:
            print("****MAX_log***")
            conversation_logs = conversation_logs[-max_logs:]
            print("conversation_logs len=",len(conversation_logs))
            print(conversation_logs)
        ''' 
    except Exception as e:
        yield f"Error: {str(e)}"








