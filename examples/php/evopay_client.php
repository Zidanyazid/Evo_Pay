<?php
final class EvoPayClient {
  public function __construct(private string $baseUrl, private string $apiKey, private int $timeout = 10) {}
  private function request(string $path, string $method = 'GET', ?array $data = null): array {
    $requestId = bin2hex(random_bytes(16)); $curl = curl_init(rtrim($this->baseUrl, '/') . '/api/v1' . $path);
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_TIMEOUT => $this->timeout, CURLOPT_HTTPHEADER => ["Authorization: Bearer {$this->apiKey}", 'Content-Type: application/json', "X-Request-Id: {$requestId}"]]);
    if ($data !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($data, JSON_THROW_ON_ERROR));
    $body = curl_exec($curl); if ($body === false) throw new RuntimeException(curl_error($curl)); $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE); curl_close($curl); $json = json_decode($body, true) ?: [];
    if ($status < 200 || $status >= 300) throw new RuntimeException(($json['error']['message'] ?? 'EvoPay request gagal.') . " [request_id: {$requestId}]"); return $json['data'];
  }
  public function paymentMethods(): array { return $this->request('/payment-methods'); }
  public function createPayment(array $input): array { return $this->request('/payments', 'POST', $input); }
  public function getPayment(string $id): array { return $this->request('/payments/' . rawurlencode($id)); }
  public function syncPayment(string $id): array { return $this->request('/payments/' . rawurlencode($id) . '/sync', 'POST'); }
}
