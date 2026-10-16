from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher


async def test_keeps_the_original_message_and_adds_dlq_headers(producer, make_record, catalog_headers):
    record = make_record(headers=[*catalog_headers, ("x-empty", None)])

    await DeadLetterPublisher(producer, "compliance.product-created.dlq").send(record, "Invalid CloudEvent.")

    [message] = producer.sent
    assert message.topic == "compliance.product-created.dlq"
    assert message.key == record.key
    assert message.value == record.value
    assert message.headers[: len(catalog_headers)] == catalog_headers
    assert ("x-empty", None) not in message.headers
    assert message.headers[len(catalog_headers) :] == [
        ("dlq-original-topic", b"catalog.product.created.v1"),
        ("dlq-original-partition", b"1"),
        ("dlq-original-offset", b"7"),
        ("dlq-reason", b"Invalid CloudEvent."),
    ]
