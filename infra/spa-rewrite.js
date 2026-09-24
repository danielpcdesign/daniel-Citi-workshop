// viewer-request on the s3 (default) behavior only: a client-side route like /tickets has no object in the bucket,
// so serve the app shell and let react router resolve it. paths with an extension are real assets and pass through
function handler(event)
{
    var request = event.request;
    var lastSegment = request.uri.split('/').pop();
    if (!request.uri.startsWith('/api/') && lastSegment.indexOf('.') === -1)
    {
        request.uri = '/index.html';
    }
    return request;
}
