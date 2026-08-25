<?php
function verify_evo_pay_webhook(string $rawBody, string $signature, string $secret): bool { $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret); return hash_equals($expected, $signature); }
function handle_payment_paid(string $rawBody, string $signature, string $deliveryId, string $secret): array {
  if (!verify_evo_pay_webhook($rawBody, $signature, $secret)) throw new RuntimeException('Webhook signature tidak valid.');
  // ponytail: atomically check/store $deliveryId in your database before processing.
  return json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
}
